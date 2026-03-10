import { DOM } from './dom.js';
import { appState } from './state.js';
import { renderPreview } from './markdownEngine.js';

export function setupFileUploader() {
  if (DOM.uploadBtn) {
    DOM.uploadBtn.addEventListener('click', () => {
      DOM.uploadModal.hidden = false;
      if (DOM.uploadModalDefault) DOM.uploadModalDefault.hidden = false;
      if (DOM.uploadModalSelection) DOM.uploadModalSelection.hidden = true;
    });
  }

  if (DOM.closeUploadModal) {
    DOM.closeUploadModal.addEventListener('click', () => {
      DOM.uploadModal.hidden = true;
    });
  }

  if (DOM.uploadModal) {
    DOM.uploadModal.addEventListener('click', (e) => {
      if (e.target === DOM.uploadModal) DOM.uploadModal.hidden = true;
    });
  }

  if (DOM.uploadModalCancel) {
    DOM.uploadModalCancel.addEventListener('click', () => {
      if (DOM.uploadModalSelection) DOM.uploadModalSelection.hidden = true;
      if (DOM.uploadModalDefault) DOM.uploadModalDefault.hidden = false;
    });
  }

  if (DOM.fileInput) {
    DOM.fileInput.addEventListener('change', (e) => handleMarkdownUpload(e.target.files));
  }
  
  if (DOM.folderInput) {
    DOM.folderInput.addEventListener('change', (e) => handleMarkdownUpload(e.target.files));
  }
}

function handleMarkdownUpload(filesList) {
  const files = Array.from(filesList);
  if (!files.length) return;

  if (DOM.fileInput) DOM.fileInput.value = '';
  if (DOM.folderInput) DOM.folderInput.value = '';

  const mdFiles = files.filter(f => f.name.match(/\.(md|markdown|txt)$/i));

  if (mdFiles.length === 0) {
    alert("No Markdown (.md, .markdown, .txt) files were found in the selected folder.");
    return;
  }

  const otherFiles = files.filter(f => f.type.startsWith('image/'));
  const fileMap = {};
  otherFiles.forEach(f => {
    if (f.webkitRelativePath) fileMap[f.webkitRelativePath] = f;
    fileMap[f.name] = f;
  });

  if (mdFiles.length > 1 && DOM.uploadModalDefault && DOM.uploadModalSelection && DOM.uploadModalFileList) {
    DOM.uploadModalDefault.hidden = true;
    DOM.uploadModalSelection.hidden = false;
    DOM.uploadModalFileList.innerHTML = '';
    
    mdFiles.forEach((mdFile) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.fontWeight = '500';
      btn.style.overflow = 'hidden';
      btn.style.textOverflow = 'ellipsis';
      btn.style.whiteSpace = 'nowrap';
      
      const displayName = mdFile.name;
      btn.textContent = displayName;
      
      btn.onclick = () => {
        DOM.uploadModalSelection.hidden = true;
        DOM.uploadModalDefault.hidden = false;
        processMarkdownFile(mdFile, fileMap);
      };
      
      DOM.uploadModalFileList.appendChild(btn);
    });
    return;
  }

  processMarkdownFile(mdFiles[0], fileMap);
}

function processMarkdownFile(mdFile, fileMap) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    let content = ev.target.result;
    
    content = content.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (match, alt, src) => {
      if (/^(https?:|data:)/.test(src)) return match;
      
      let matchedFile = null;
      const cleanSrc = src.replace(/^\.\//, '');
      const possiblePathMatches = Object.keys(fileMap).filter(path => path.endsWith(cleanSrc));
      
      if (possiblePathMatches.length > 0) {
        matchedFile = fileMap[possiblePathMatches[0]];
      } else {
        const filename = src.split('/').pop();
        if (fileMap[filename]) matchedFile = fileMap[filename];
      }

      if (matchedFile) {
        const blobUrl = URL.createObjectURL(matchedFile);
        appState.previewBlobUrls.push(blobUrl);
        return `![${alt}](${blobUrl})`;
      }
      return match;
    });

    DOM.markdownInput.value = content;
    renderPreview();
    DOM.uploadModal.hidden = true;
  };
  reader.readAsText(mdFile);
}
