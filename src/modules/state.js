export const appState = {
  mdUrlSuccessTimer: null,
  
  // Scraper State
  currentZipToken: null,
  currentZipBase64: null,
  currentArticleName: 'article',
  currentMarkdownContent: '',
  
  // UI State
  previewBlobUrls: [],
  isSyncingScroll: false,
  isScrolling: false,
  debounceResize: null
};
