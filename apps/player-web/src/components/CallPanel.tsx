import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Color, Mode } from '@four-chess/engine';
import { seatColors } from '@four-chess/engine';
import { fetchRtcConfig, User } from '../api';
import { COLOR_HEX } from '../config';
import { SeatInfo } from '../types';
import {
  CameraIcon,
  CameraOffIcon,
  EyeIcon,
  EyeOffIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from './Icons';

// In-game voice/video between the human players. Signaling rides the game
// socket ('rtc:signal' envelopes relayed by the server); audio and video flow
// peer-to-peer in a small mesh. The peer with the lower userId makes the offer.
//
// Every connection is negotiated with an audio and a video channel from the
// start, so the camera can be switched on and off mid-call by swapping the
// track on the existing channel: no renegotiation, no rejoining.
//
// The server supplies the ICE servers (STUN/TURN); this is only the fallback.
const DEFAULT_ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type MediaState = { mic: boolean; cam: boolean };

type Signal =
  | { type: 'hello' }
  | { type: 'hello-ack' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | ({ type: 'state' } & MediaState)
  | { type: 'bye' };

interface Peer {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  hasRemote: boolean;
  stream: MediaStream; // everything received from this player
}

// what this player chose to silence or hide, for themselves only
interface Pref {
  muted: boolean;
  hidden: boolean;
}

const NO_PREF: Pref = { muted: false, hidden: false };

function mediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Permission denied — allow the microphone/camera for this site and try again.';
  if (name === 'NotFoundError') return 'No microphone or camera was found on this device.';
  if (name === 'NotReadableError') return 'The microphone or camera is in use by another app.';
  return 'Microphone/camera unavailable — check browser permissions.';
}

const videoSender = (pc: RTCPeerConnection) =>
  pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;

export function CallPanel({
  socket,
  gameId,
  me,
  seats,
  mode,
  enabled,
  onStatus,
  children,
}: {
  socket: Socket | null;
  gameId: string;
  me: User;
  seats: Record<Color, SeatInfo>;
  mode: Mode;
  enabled: boolean; // calls are for seated players while the game runs
  onStatus?: (inCall: boolean) => void;
  children?: ReactNode; // shown between the video tiles and the call controls
}) {
  const others = seatColors(mode).flatMap((color) => {
    const s = seats[color];
    return s?.kind === 'human' && s.userId !== me.id ? [{ userId: s.userId, username: s.username, color }] : [];
  });
  const myColor = seatColors(mode).find((c) => {
    const s = seats[c];
    return s?.kind === 'human' && s.userId === me.id;
  });

  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false); // waiting for a device or permission
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>([]); // userIds with a live connection
  const [remoteState, setRemoteState] = useState<Record<string, MediaState>>({});
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const [preview, setPreview] = useState<MediaStream | null>(null); // own camera

  const audioRef = useRef<MediaStreamTrack | null>(null);
  const cameraRef = useRef<MediaStreamTrack | null>(null);
  const iceRef = useRef<RTCConfiguration>(DEFAULT_ICE);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const stateRef = useRef<MediaState>({ mic: true, cam: false });
  const joinedRef = useRef(joined);
  joinedRef.current = joined;

  const send = useCallback(
    (to: string, data: Signal) => {
      socket?.emit('rtc:signal', { gameId, to, data });
    },
    [socket, gameId],
  );

  // tells one player, or everyone in the call, whether our mic and camera are on
  const sendState = useCallback(
    (to?: string) => {
      const targets = to ? [to] : [...peersRef.current.keys()];
      for (const id of targets) send(id, { type: 'state', ...stateRef.current });
    },
    [send],
  );

  const closePeer = useCallback((userId: string) => {
    const peer = peersRef.current.get(userId);
    if (peer) {
      peer.pc.close();
      peersRef.current.delete(userId);
    }
    setConnected((list) => list.filter((id) => id !== userId));
  }, []);

  const ensurePeer = useCallback(
    (userId: string): Peer => {
      let peer = peersRef.current.get(userId);
      if (peer) return peer;
      const pc = new RTCPeerConnection(iceRef.current);
      const stream = new MediaStream();
      peer = { pc, pendingIce: [], hasRemote: false, stream };
      peersRef.current.set(userId, peer);
      pc.ontrack = (ev) => {
        stream.addTrack(ev.track);
        setConnected((list) => (list.includes(userId) ? list : [...list, userId]));
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) send(userId, { type: 'ice', candidate: ev.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(userId);
      };
      return peer;
    },
    [send, closePeer],
  );

  // puts our microphone and camera (or nothing yet) on both channels
  const attachLocal = useCallback(async (pc: RTCPeerConnection) => {
    for (const t of pc.getTransceivers()) {
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(t.receiver.track.kind === 'audio' ? audioRef.current : cameraRef.current);
    }
  }, []);

  const connectTo = useCallback(
    async (userId: string) => {
      const peer = ensurePeer(userId);
      sendState(userId);
      if (me.id < userId && peer.pc.getTransceivers().length === 0) {
        peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
        peer.pc.addTransceiver('video', { direction: 'sendrecv' });
        await attachLocal(peer.pc);
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        send(userId, { type: 'offer', sdp: offer });
      }
    },
    [ensurePeer, attachLocal, sendState, me.id, send],
  );

  // signaling
  useEffect(() => {
    if (!socket) return;
    const onSignal = async ({ gameId: g, from, data }: { gameId: string; from: string; data: Signal }) => {
      if (g !== gameId) return;
      try {
        if (data.type === 'hello') {
          if (!joinedRef.current) return;
          send(from, { type: 'hello-ack' });
          await connectTo(from);
        } else if (data.type === 'hello-ack') {
          await connectTo(from);
        } else if (data.type === 'offer') {
          if (!joinedRef.current) return;
          const peer = ensurePeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          peer.hasRemote = true;
          for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
          await attachLocal(peer.pc);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          send(from, { type: 'answer', sdp: answer });
          sendState(from);
        } else if (data.type === 'answer') {
          const peer = peersRef.current.get(from);
          if (!peer) return;
          await peer.pc.setRemoteDescription(data.sdp);
          peer.hasRemote = true;
          for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        } else if (data.type === 'ice') {
          const peer = peersRef.current.get(from);
          if (!peer) return;
          if (peer.hasRemote) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
          else peer.pendingIce.push(data.candidate);
        } else if (data.type === 'state') {
          setRemoteState((s) => ({ ...s, [from]: { mic: !!data.mic, cam: !!data.cam } }));
        } else if (data.type === 'bye') {
          closePeer(from);
        }
      } catch {
        // one bad signal shouldn't take the call down
      }
    };
    socket.on('rtc:signal', onSignal);
    return () => {
      socket.off('rtc:signal', onSignal);
    };
  }, [socket, gameId, send, sendState, connectTo, ensurePeer, attachLocal, closePeer]);

  const stopCamera = useCallback(async () => {
    const track = cameraRef.current;
    cameraRef.current = null;
    track?.stop();
    setPreview(null);
    stateRef.current = { ...stateRef.current, cam: false };
    setCamOn(false);
    for (const peer of peersRef.current.values()) await videoSender(peer.pc)?.replaceTrack(null).catch(() => {});
  }, []);

  const leave = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) {
      send(id, { type: 'bye' });
      closePeer(id);
    }
    audioRef.current?.stop();
    audioRef.current = null;
    cameraRef.current?.stop();
    cameraRef.current = null;
    stateRef.current = { mic: true, cam: false };
    setPreview(null);
    setConnected([]);
    setRemoteState({});
    setJoined(false);
    setMicOn(true);
    setCamOn(false);
    setError(null);
  }, [send, closePeer]);

  useEffect(() => leave, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled && joinedRef.current) leave();
  }, [enabled, leave]);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(joined);
  }, [joined]);

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      const cfg = await fetchRtcConfig();
      if (Array.isArray(cfg?.iceServers) && cfg.iceServers.length > 0) iceRef.current = { iceServers: cfg.iceServers };
    } catch {
      // keep the built-in STUN fallback
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioRef.current = stream.getAudioTracks()[0] ?? null;
      stateRef.current = { mic: true, cam: false };
      setMicOn(true);
      setJoined(true);
      for (const o of others) send(o.userId, { type: 'hello' });
    } catch (err) {
      setError(mediaError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    const next = !micOn;
    if (audioRef.current) audioRef.current.enabled = next;
    stateRef.current = { ...stateRef.current, mic: next };
    setMicOn(next);
    sendState();
  };

  const toggleCamera = async () => {
    setError(null);
    if (camOn) {
      await stopCamera();
      sendState();
      return;
    }
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new DOMException('no camera', 'NotFoundError');
      // unplugged, or switched off from the browser's own controls
      track.onended = () => {
        void stopCamera().then(() => sendState());
      };
      cameraRef.current = track;
      setPreview(new MediaStream([track]));
      stateRef.current = { ...stateRef.current, cam: true };
      setCamOn(true);
      for (const peer of peersRef.current.values()) await videoSender(peer.pc)?.replaceTrack(track);
      sendState();
    } catch (err) {
      setError(mediaError(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePref = (userId: string, key: keyof Pref) =>
    setPrefs((p) => {
      const current = p[userId] ?? NO_PREF;
      return { ...p, [userId]: { ...current, [key]: !current[key] } };
    });

  // browsers only expose the microphone and camera on https or localhost
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const alone = others.length === 0;
  const inCall = others.filter((o) => connected.includes(o.userId));

  if (!enabled) return <div className="call">{children}</div>;

  return (
    <div className="call">
      {joined && (
        <div className="call-tiles">
          <Tile
            name="You"
            color={myColor ? COLOR_HEX[myColor] : undefined}
            stream={preview}
            showVideo={camOn}
            micOn={micOn}
            mirrored
            silent
          />
          {inCall.map((o) => {
            const state = remoteState[o.userId] ?? { mic: true, cam: false };
            const pref = prefs[o.userId] ?? NO_PREF;
            return (
              <Tile
                key={o.userId}
                name={o.username}
                color={COLOR_HEX[o.color]}
                stream={peersRef.current.get(o.userId)?.stream ?? null}
                showVideo={state.cam && !pref.hidden}
                micOn={state.mic}
                silent={pref.muted}
              >
                <button
                  className={`tile-btn ${pref.muted ? 'on' : ''}`}
                  onClick={() => togglePref(o.userId, 'muted')}
                  aria-pressed={pref.muted}
                  title={pref.muted ? `Unmute ${o.username} (only for you)` : `Mute ${o.username} (only for you)`}
                >
                  {pref.muted ? <SpeakerOffIcon size={14} /> : <SpeakerIcon size={14} />}
                </button>
                <button
                  className={`tile-btn ${pref.hidden ? 'on' : ''}`}
                  onClick={() => togglePref(o.userId, 'hidden')}
                  aria-pressed={pref.hidden}
                  title={
                    pref.hidden ? `Show ${o.username}'s video (only for you)` : `Hide ${o.username}'s video (only for you)`
                  }
                >
                  {pref.hidden ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                </button>
              </Tile>
            );
          })}
          {inCall.length === 0 && <div className="muted small call-waiting">Waiting for others to join…</div>}
        </div>
      )}

      {children}

      {error && <div className="error small">{error}</div>}

      <div className="call-bar" role="group" aria-label="Call controls">
        {joined ? (
          <>
            <button
              className={`round-btn ${micOn ? '' : 'off'}`}
              onClick={toggleMic}
              aria-pressed={!micOn}
              title={micOn ? 'Mute your microphone' : 'Unmute your microphone'}
            >
              {micOn ? <MicIcon /> : <MicOffIcon />}
            </button>
            <button
              className={`round-btn ${camOn ? '' : 'off'}`}
              onClick={() => void toggleCamera()}
              disabled={busy}
              aria-pressed={!camOn}
              title={camOn ? 'Turn your camera off' : 'Turn your camera on'}
            >
              {camOn ? <CameraIcon /> : <CameraOffIcon />}
            </button>
            <button className="round-btn hangup" onClick={leave} title="Leave the call">
              <HangUpIcon />
            </button>
          </>
        ) : (
          <button className="call-join" onClick={() => void join()} disabled={alone || !supported || busy}>
            <PhoneIcon size={16} />
            {busy ? 'Joining…' : 'Join call'}
          </button>
        )}
      </div>
      {!joined &&
        (!supported ? (
          <div className="muted small call-note">Calls need a secure address — open the site over https.</div>
        ) : (
          alone && <div className="muted small call-note">Calls start when another player is in the game.</div>
        ))}
    </div>
  );
}

// One participant: their video when it is on and wanted, otherwise their
// initial on their seat colour. The audio plays from the same element.
function Tile({
  name,
  color,
  stream,
  showVideo,
  micOn,
  mirrored = false,
  silent = false,
  children,
}: {
  name: string;
  color?: string;
  stream: MediaStream | null;
  showVideo: boolean;
  micOn: boolean;
  mirrored?: boolean;
  silent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="call-tile">
      {stream && (
        <video
          autoPlay
          playsInline
          muted={silent}
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined, display: showVideo ? 'block' : 'none' }}
          ref={(el) => {
            if (!el) return;
            if (el.srcObject !== stream) el.srcObject = stream;
            el.muted = silent;
          }}
        />
      )}
      {!showVideo && (
        <div className="call-avatar" style={{ background: color }}>
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <span className="call-name">
        {!micOn && <MicOffIcon size={11} />}
        {name}
      </span>
      {children && <div className="tile-actions">{children}</div>}
    </div>
  );
}
