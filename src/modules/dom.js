export const DOM = {
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-content'),

  // MD -> Medium tab
  markdownInput: document.getElementById('markdown-input'),
  previewContent: document.getElementById('preview-content'),
  copyBtn: document.getElementById('copy-btn'),
  clearBtn: document.getElementById('clear-btn'),
  exportHtmlBtn: document.getElementById('export-html-btn'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  reformatBtn: document.getElementById('reformat-btn'),
  
  // URL Input Form (GitHub/Gitlab to MD)
  mdUrlForm: document.getElementById('md-url-form'),
  mdUrlInput: document.getElementById('md-url-input'),
  mdUrlFetchBtn: document.getElementById('md-url-fetch-btn'),
  mdUrlErrorBar: document.getElementById('md-url-error'),

  // General App
  themeToggle: document.getElementById('theme-toggle'),

  // Medium -> MD Tab
  urlForm: document.getElementById('url-form'),
  urlInput: document.getElementById('url-input'),
  bypassCacheCheckbox: document.getElementById('bypass-cache-checkbox'),
  convertBtn: document.getElementById('convert-btn'),
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  errorMessage: document.getElementById('error-message'),
  errorText: document.getElementById('error-text'),
  downloadSection: document.getElementById('download-section'),
  downloadBtn: document.getElementById('download-btn'),
  m2mdPreviewContent: document.getElementById('m2md-preview-content'),
  m2mdCopyBtn: document.getElementById('m2md-copy-btn'),
  m2mdExportHtmlBtn: document.getElementById('m2md-export-html-btn'),
  m2mdExportPdfBtn: document.getElementById('m2md-export-pdf-btn'),

  // Modals & Uploads
  uploadBtn: document.getElementById('upload-btn'),
  uploadModal: document.getElementById('upload-modal'),
  closeUploadModal: document.getElementById('close-upload-modal'),
  folderInput: document.getElementById('folder-input'),
  fileInput: document.getElementById('file-input'),
  uploadModalDefault: document.getElementById('upload-modal-default'),
  uploadModalSelection: document.getElementById('upload-modal-selection'),
  uploadModalFileList: document.getElementById('upload-modal-file-list'),
  uploadModalCancel: document.getElementById('upload-modal-cancel'),

  // Word Counters
  wordCountEl: document.getElementById('md-word-count'),
  charCountEl: document.getElementById('md-char-count'),
  m2mdWordCountEl: document.getElementById('m2md-word-count'),
  m2mdCharCountEl: document.getElementById('m2md-char-count')
};
