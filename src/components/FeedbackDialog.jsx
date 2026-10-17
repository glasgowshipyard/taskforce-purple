// "Something wrong with this grade?" (a flag on one member) and "Suggest
// something" (anything about the site), in one dialog. Both land on /admin,
// nowhere else (workers/admin).
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import HumanCheck from './HumanCheck.jsx';
import { FLAG_REASONS, SUGGESTION_KINDS, sendFeedback } from '../lib/feedback.js';

const MAX_TEXT = 1000;

/** kind: 'flag' (needs member: { id, name }) or 'suggestion' */
export default function FeedbackDialog({ open, onClose, kind, member = null }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [decoy, setDecoy] = useState('');
  const [token, setToken] = useState(null);
  const [round, setRound] = useState(0);
  const [state, setState] = useState({ sending: false, sent: false, error: '' });
  const flag = kind === 'flag';
  const choices = flag ? FLAG_REASONS : SUGGESTION_KINDS;

  useEffect(() => {
    const d = ref.current;
    if (!d) {
      return;
    }
    if (open && !d.open) {
      d.showModal();
      setState({ sending: false, sent: false, error: '' });
      setReason(flag ? '' : 'idea');
      setText('');
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, flag]);

  const submit = async e => {
    e.preventDefault();
    if (flag && !reason) {
      setState(s => ({ ...s, error: 'Pick what looks wrong.' }));
      return;
    }
    if ((!flag || reason === 'other') && text.trim().length < 3) {
      setState(s => ({
        ...s,
        error: flag ? 'Say what looks wrong.' : 'Write a few words first.',
      }));
      return;
    }
    if (!token) {
      setState(s => ({
        ...s,
        error: 'One moment: still checking you’re a person. Try again in a second.',
      }));
      return;
    }
    setState({ sending: true, sent: false, error: '' });
    try {
      await sendFeedback(kind, {
        memberId: member?.id,
        reason,
        text: text.trim(),
        page: window.location.pathname,
        token,
        website: decoy,
      });
      setState({ sending: false, sent: true, error: '' });
    } catch (err) {
      setState({ sending: false, sent: false, error: err.message });
    } finally {
      // A token works once: draw a fresh check for another go
      setToken(null);
      setRound(r => r + 1);
    }
  };

  const title = flag ? 'Something wrong with this grade?' : 'Suggest something';
  return (
    <dialog
      ref={ref}
      className="share-dialog feedback-dialog"
      aria-labelledby="feedback-title"
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
    >
      <div className="share-body">
        <div className="share-head">
          <h2 id="feedback-title" className="display display-m">
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        {state.sent ? (
          <div className="feedback-done" role="status">
            <p>
              <strong>Thanks, got it.</strong>{' '}
              {flag
                ? `${member?.name ?? 'This member'}’s figures will be checked against the FEC’s records.`
                : 'Every one gets read.'}
            </p>
            <button type="button" className="btn btn-dark" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          open && (
            <form className="feedback-form" onSubmit={submit} noValidate>
              {flag && (
                <p className="small muted">
                  About {member?.name}’s grade. Say what looks wrong and it will be checked against
                  the FEC’s records.
                </p>
              )}
              <fieldset>
                <legend className="sr-only">{flag ? 'What looks wrong' : 'What kind'}</legend>
                <div className="feedback-choices">
                  {choices.map(c => (
                    <label key={c.value} className="feedback-choice">
                      <input
                        type="radio"
                        name="feedback-reason"
                        value={c.value}
                        checked={reason === c.value}
                        onChange={() => setReason(c.value)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="feedback-label" htmlFor="feedback-text">
                {flag
                  ? reason === 'other'
                    ? 'What looks wrong?'
                    : 'Anything to add? (optional)'
                  : 'Your suggestion'}
              </label>
              <textarea
                id="feedback-text"
                rows={4}
                maxLength={MAX_TEXT}
                value={text}
                onChange={e => setText(e.target.value)}
              />
              {/* People never see this; bots fill it in, and are dropped */}
              <div className="sr-only" aria-hidden="true">
                <label>
                  Website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={decoy}
                    onChange={e => setDecoy(e.target.value)}
                  />
                </label>
              </div>
              <HumanCheck onToken={setToken} resetKey={round} />
              <div className="row">
                <button type="submit" className="btn btn-purple" disabled={state.sending}>
                  {state.sending ? 'Sending…' : 'Send'}
                </button>
                <span className="small muted">Only the people who run this site will see it.</span>
              </div>
              <p className="small feedback-error" role="alert">
                {state.error}
              </p>
            </form>
          )
        )}
      </div>
    </dialog>
  );
}
