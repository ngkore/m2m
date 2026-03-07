import archiver from 'archiver';
import { PassThrough } from 'stream';

/**
 * Generate a ZIP buffer containing the article.md and images.
 * @param {string} markdown - The Markdown content
 * @param {Array<{filename: string, buffer: Buffer}>} images - Downloaded images
 * @param {string} folderName - Name for the root folder inside the ZIP
 * @returns {Promise<Buffer>} ZIP file as a buffer
 */
export async function generateZip(markdown, images, folderName) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    // Pipe through PassThrough to reliably collect all output chunks
    const pass = new PassThrough();
    archive.pipe(pass);

    pass.on('data', (chunk) => chunks.push(chunk));
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', (err) => reject(err));
    archive.on('error', (err) => reject(err));


    archive.append(Buffer.from(markdown, 'utf-8'), {
      name: `${folderName}/${folderName}.md`,
    });


    for (const img of images) {
      archive.append(img.buffer, {
        name: `${folderName}/images/${img.filename}`,
      });
    }

    archive.finalize();
  });
}
