// Images are private Drive files. The script returns them as base64 after an
// access check, and they are shown from a data: URL.
import { base64ByteLength } from '../../shared/image';
import { MAX_IMAGE_BYTES } from '../../shared/constants';
import { api } from '../api';
import { h, replace } from '../dom';
import { errorBox, loading } from './components';

export function remoteImage(action: string, payload: unknown, alt: string): HTMLElement {
  const box = h('figure', { class: 'chart-image' });
  replace(box, loading('Loading image…'));
  api<{ mimeType: string; base64: string }>(action, payload).then(
    (img) => {
      // Only ever build data: URLs for PNG/JPEG with plain base64 content.
      if (
        !['image/png', 'image/jpeg'].includes(img.mimeType) ||
        !/^[A-Za-z0-9+/=]+$/.test(img.base64)
      ) {
        replace(box, errorBox(new Error('The image could not be shown.')));
        return;
      }
      const src = `data:${img.mimeType};base64,${img.base64}`;
      replace(
        box,
        h('img', { src, alt }),
        h(
          'figcaption',
          null,
          h(
            'a',
            { href: src, download: `chart.${img.mimeType === 'image/png' ? 'png' : 'jpg'}` },
            'Download chart image',
          ),
        ),
      );
    },
    (err) => replace(box, errorBox(err)),
  );
  return box;
}

export interface PickedImage {
  base64: string;
  mimeType: string;
  name: string;
}

/** Accepted in the file pickers. AVIF is converted to PNG (or JPG) before upload. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/avif,.avif';

function isAvif(file: File): boolean {
  return file.type === 'image/avif' || /.avif$/i.test(file.name);
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * Claude, Drive previews and the server checks all expect PNG or JPG, so an AVIF chart is
 * redrawn on a canvas and saved as PNG; as JPG if the PNG would be over 5 MB.
 */
async function convertAvif(file: File): Promise<PickedImage> {
  const img = new Image();
  img.src = await readDataUrl(file); // a data: URL, which the Content-Security-Policy allows
  try {
    await img.decode();
  } catch {
    throw new Error('This browser could not open the AVIF image. Save it as PNG or JPG instead.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Could not convert the AVIF image. Save it as PNG or JPG instead.');
  g.fillStyle = '#ffffff'; // transparent areas become white, not black, in a JPG
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0);
  const base = file.name.replace(/.avif$/i, '');
  for (const [mimeType, ext, quality] of [
    ['image/png', 'png', undefined],
    ['image/jpeg', 'jpg', 0.92],
  ] as const) {
    const url = canvas.toDataURL(mimeType, quality);
    const base64 = url.slice(url.indexOf(',') + 1);
    if (base64ByteLength(base64) <= MAX_IMAGE_BYTES) {
      return { base64, mimeType, name: `${base}.${ext}` };
    }
  }
  throw new Error('The chart image must be 5 MB or smaller.');
}

/** Read a chosen file as base64 after checking type and size in the browser too. */
export async function readImageFile(file: File): Promise<PickedImage> {
  const avif = isAvif(file);
  if (!avif && !['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('The chart image must be a PNG, JPG or AVIF file.');
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('The chart image must be 5 MB or smaller.');
  if (avif) return convertAvif(file);
  const url = await readDataUrl(file);
  return { base64: url.slice(url.indexOf(',') + 1), mimeType: file.type, name: file.name };
}
