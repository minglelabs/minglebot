import path from "node:path";
import { promises as fs } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";

const CLAUDE_EXPORT_URL = "https://claude.ai/settings/privacy";
const CLAUDE_PROFILE_DIR = ".browser-sessions/claude";

export type ClaudeAutomationState =
  | "idle"
  | "starting"
  | "active_login_required"
  | "active_ready"
  | "stopped";

export interface ClaudeAutomationStatus {
  active: boolean;
  state: ClaudeAutomationState;
  message: string;
  startedAt?: string;
  currentUrl?: string;
  profilePath?: string;
  reusedSession?: boolean;
}

interface ClaudeAutomationSession {
  context: BrowserContext;
  page: Page;
  startedAt: string;
  profilePath: string;
  state: Exclude<ClaudeAutomationState, "idle" | "stopped">;
  message: string;
}

let activeSession: ClaudeAutomationSession | null = null;
let startPromise: Promise<ClaudeAutomationStatus> | null = null;

function safeCurrentUrl(page: Page): string | undefined {
  try {
    return page.url() || undefined;
  } catch {
    return undefined;
  }
}

function toStatus(session: ClaudeAutomationSession): ClaudeAutomationStatus {
  return {
    active: true,
    state: session.state,
    message: session.message,
    startedAt: session.startedAt,
    currentUrl: safeCurrentUrl(session.page),
    profilePath: session.profilePath
  };
}

function loginHintVisible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
}

async function requiresLogin(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("/login") || url.includes("/auth")) return true;

  const hints = await Promise.all([
    loginHintVisible(page, 'input[type="password"]'),
    loginHintVisible(page, 'button:has-text("Continue with Google")'),
    loginHintVisible(page, 'button:has-text("Continue with email")'),
    loginHintVisible(page, 'button:has-text("Sign in")'),
    loginHintVisible(page, 'a:has-text("Log in")')
  ]);

  return hints.some(Boolean);
}

function buildPlaywrightError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("Executable doesn't exist") || raw.includes("browserType.launch")) {
    return new Error(`${raw}\n\nInstall browser binaries with: pnpm exec playwright install chromium`);
  }
  return error instanceof Error ? error : new Error(raw);
}

async function createContext(profilePath: string): Promise<BrowserContext> {
  const options = {
    headless: false,
    viewport: null as null,
    args: ["--start-maximized"],
    channel: process.platform === "darwin" || process.platform === "win32" ? "chrome" : undefined
  };

  try {
    return await chromium.launchPersistentContext(profilePath, options);
  } catch (error) {
    if (!options.channel) {
      throw error;
    }

    const fallbackOptions = { ...options, channel: undefined };
    return chromium.launchPersistentContext(profilePath, fallbackOptions);
  }
}

async function initializeClaudeAutomation(session: ClaudeAutomationSession): Promise<void> {
  await session.page.goto(CLAUDE_EXPORT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await session.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

  if (await requiresLogin(session.page)) {
    session.state = "active_login_required";
    session.message =
      "Claude login is required in the opened browser. Sign in, then request export from privacy settings.";
    return;
  }

  session.state = "active_ready";
  session.message =
    "Claude privacy page is ready. Complete any bot check manually, then click the export request yourself.";
}

export function getClaudeAutomationStatus(): ClaudeAutomationStatus {
  if (!activeSession) {
    return {
      active: false,
      state: "idle",
      message: "No Claude automation session is running."
    };
  }

  return toStatus(activeSession);
}

export async function startClaudeAutomation(dataRoot: string): Promise<ClaudeAutomationStatus> {
  if (activeSession) {
    await activeSession.page.bringToFront().catch(() => undefined);
    return {
      ...toStatus(activeSession),
      reusedSession: true,
      message: "Claude automation is already running. Focus switched to that browser window."
    };
  }

  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    const profilePath = path.resolve(dataRoot, CLAUDE_PROFILE_DIR);
    await fs.mkdir(profilePath, { recursive: true });

    const context = await createContext(profilePath);
    const page = context.pages()[0] ?? (await context.newPage());

    const session: ClaudeAutomationSession = {
      context,
      page,
      startedAt: new Date().toISOString(),
      profilePath,
      state: "starting",
      message: "Starting Claude automation..."
    };
    activeSession = session;

    context.on("close", () => {
      if (activeSession?.context === context) {
        activeSession = null;
      }
    });

    try {
      await initializeClaudeAutomation(session);
      return toStatus(session);
    } catch (error) {
      if (activeSession?.context === context) {
        activeSession = null;
      }
      await context.close().catch(() => undefined);
      throw buildPlaywrightError(error);
    }
  })()
    .catch((error) => {
      throw buildPlaywrightError(error);
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
}

export async function stopClaudeAutomation(): Promise<ClaudeAutomationStatus> {
  if (!activeSession) {
    return {
      active: false,
      state: "idle",
      message: "No Claude automation session is running."
    };
  }

  const current = activeSession;
  activeSession = null;
  await current.context.close().catch(() => undefined);

  return {
    active: false,
    state: "stopped",
    message: "Claude automation session was closed.",
    profilePath: current.profilePath
  };
}
