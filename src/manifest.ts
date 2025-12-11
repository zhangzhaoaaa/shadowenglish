export default {
  manifest_version: 3,
  name: "Speak Practice Loop",
  version: "0.1.0",
  description: "Practice speaking with YouTube loop",
  permissions: ["sidePanel", "activeTab", "scripting", "storage", "tabs"],
  host_permissions: ["*://*.youtube.com/*"],
  side_panel: {
    default_path: "sidepanel.html"
  }
}
