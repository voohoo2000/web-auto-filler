
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateBadge") {
    try {
        const text = request.count > 0 ? request.count.toString() : "";
        if (sender.tab && sender.tab.id) {
            chrome.action.setBadgeText({ text: text, tabId: sender.tab.id });
            chrome.action.setBadgeBackgroundColor({ color: "#28a745", tabId: sender.tab.id });
        }
    } catch (e) {}
  }
});
