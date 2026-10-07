// Share a receipt: the card is drawn in the browser, then handed to the
// phone's share sheet, or saved, with the link copied.
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Download, Share2, X } from 'lucide-react';
import { canvasToBlob, drawShareCard } from '../lib/share-card.js';

export default function ShareDialog({ open, onClose, card, url, text, filename }) {
  const ref = useRef(null);
  const [image, setImage] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) {
      return;
    }
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let cancelled = false;
    let objectUrl = null;
    setNote('');
    drawShareCard(card)
      .then(canvasToBlob)
      .then(blob => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setImage({ blob, src: objectUrl });
        }
      })
      .catch(
        () =>
          !cancelled && setNote("We couldn't draw the picture, but you can still copy the link.")
      );
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setImage(null);
    };
    // The card is rebuilt each render; it only changes with the person
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card.id]);

  const file = image ? new File([image.blob], filename, { type: 'image/png' }) : null;
  const canShareFile = Boolean(file && navigator.canShare?.({ files: [file] }));

  const share = async () => {
    try {
      await navigator.share(
        canShareFile
          ? { files: [file], title: text, text: `${text} ${url}` }
          : { title: text, text, url }
      );
    } catch {
      // Cancelled: nothing to do
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote('Link copied.');
    } catch {
      setNote(`Copy this link: ${url}`);
    }
  };

  return (
    <dialog
      ref={ref}
      className="share-dialog"
      aria-labelledby="share-title"
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
    >
      <div className="share-body">
        <div className="share-head">
          <h2 id="share-title" className="display display-m">
            Share this receipt
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="share-preview">
          {image ? (
            <img src={image.src} alt={`Share card: ${text}`} width="1200" height="630" />
          ) : (
            <div className="skeleton" style={{ aspectRatio: '1200 / 630' }} />
          )}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {navigator.share && (
            <button type="button" className="btn btn-purple" onClick={share} disabled={!image}>
              <Share2 size={18} aria-hidden="true" /> Share
            </button>
          )}
          {image && (
            <a className="btn btn-dark" href={image.src} download={filename}>
              <Download size={18} aria-hidden="true" /> Save picture
            </a>
          )}
          <button type="button" className="btn btn-outline" onClick={copy}>
            <Copy size={18} aria-hidden="true" /> Copy link
          </button>
        </div>
        <p className="small muted" role="status" style={{ marginTop: 10, minHeight: '1.5em' }}>
          {note}
        </p>
      </div>
    </dialog>
  );
}
