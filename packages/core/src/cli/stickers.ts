import { spawn } from "node:child_process";

/**
 * `skillmama stickers`: the free sticker downloads in the README. Rendering is
 * pure; openInBrowser() is the only side effect, and main.ts calls it only for a
 * person at a terminal.
 */

export const STICKERS_URL = "https://github.com/Magithar/SKILLmama#stickers";

export const STICKERS = ["Logo", "Thumbs-up", "Celebrate", "Coffee", "Sleepy cat"];

export function renderStickers(): string {
  return `
  SKILLmama stickers
    ${STICKERS.join(" · ")}

  Download them here:
    ${STICKERS_URL}

  Free to print and share, just don't sell them.
`;
}

/**
 * Best effort with the platform's own opener. Any failure is ignored, because
 * the link is always printed as well.
 */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed link is the fallback.
  }
}
