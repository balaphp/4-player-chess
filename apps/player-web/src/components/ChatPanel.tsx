import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { User } from '../api';
import { COLOR_HEX } from '../config';
import { ChatMessage } from '../types';
import { SendIcon } from './Icons';

const MAX_LENGTH = 300;

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// In-game text chat. Players write, everyone watching the game reads.
export function ChatPanel({
  socket,
  emit,
  gameId,
  me,
  canSend,
  active,
  onIncoming,
}: {
  socket: Socket | null;
  emit: (event: string, payload?: Record<string, unknown>) => Promise<any>;
  gameId: string;
  me: User;
  canSend: boolean;
  active: boolean; // is the chat currently on screen
  onIncoming: () => void; // someone else wrote while it was not
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onIncomingRef = useRef(onIncoming);
  onIncomingRef.current = onIncoming;

  useEffect(() => {
    if (!socket) return;
    let cancelled = false;
    setMessages([]);
    socket.emit('chat:history', { gameId }, (res: { ok: boolean; messages?: ChatMessage[] }) => {
      if (!cancelled && res?.ok && Array.isArray(res.messages)) setMessages(res.messages);
    });
    const onMessage = (m: ChatMessage) => {
      if (m.gameId !== gameId) return;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (!activeRef.current && m.userId !== me.id) onIncomingRef.current();
    };
    socket.on('chat:message', onMessage);
    return () => {
      cancelled = true;
      socket.off('chat:message', onMessage);
    };
  }, [socket, gameId, me.id]);

  // keep the newest message in view
  useEffect(() => {
    if (active) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, active]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await emit('chat:send', { gameId, text: body });
    setSending(false);
    if (res?.ok) setText('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted small chat-empty">No messages yet.</div>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.userId === me.id ? 'mine' : ''}`}>
            <div className="chat-meta">
              <span className="color-chip" style={{ background: COLOR_HEX[m.color] }} />
              <span className="chat-author">{m.userId === me.id ? 'You' : m.username}</span>
              <span className="muted">{timeOf(m.at)}</span>
            </div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>
      {canSend ? (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message the players"
            maxLength={MAX_LENGTH}
            aria-label="Message"
          />
          <button className="icon-btn" type="submit" disabled={!text.trim() || sending} title="Send" aria-label="Send">
            <SendIcon />
          </button>
        </form>
      ) : (
        <div className="muted small">Only players of this game can write.</div>
      )}
    </div>
  );
}
