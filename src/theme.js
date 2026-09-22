const key = "relay.appearance";
const choices = ["system", "light", "dark"];
const system = window.matchMedia("(prefers-color-scheme: dark)");

export function readTheme() {
  try {
    const saved = localStorage.getItem(key);
    return choices.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference) {
  const dark =
    preference === "dark" || (preference === "system" && system.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#121315" : "#157b68");
}

export function saveTheme(preference) {
  applyTheme(preference);
  try {
    localStorage.setItem(key, preference);
  } catch {
    // The current appearance still works when browser storage is unavailable.
  }
}

export function watchTheme(onChange) {
  let preference = readTheme();
  const mediaChange = () => applyTheme(preference);
  const storageChange = (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = readTheme();
    applyTheme(preference);
    onChange(preference);
  };
  system.addEventListener("change", mediaChange);
  window.addEventListener("storage", storageChange);
  return {
    set(next) {
      preference = next;
      saveTheme(next);
    },
    stop() {
      system.removeEventListener("change", mediaChange);
      window.removeEventListener("storage", storageChange);
    },
  };
}

applyTheme(readTheme());
