'use client';

// ── Anam SDK controller ─────────────────────────────────────────────────────
//
// Thin wrapper around @anam-ai/js-sdk that encapsulates the Anam-specific SDK
// lifecycle (createClient → streamToVideoElement → talk → stopStreaming) behind
// a small interface. The owning component keeps all the shared "avatar speaking"
// mic-lock state; this controller only touches the SDK.
//
// The SDK is browser-only, so this whole module is dynamically imported
// (`await import('@/lib/avatar/anam-controller')`) to keep it out of the server
// bundle.

import type { AnamClient } from '@anam-ai/js-sdk';

export interface AnamInitOptions {
  /** Short-lived token from POST /api/anam/session-token. */
  sessionToken: string;
  /** DOM id of the <video> element the avatar streams into. */
  videoElementId: string;
  /** Fires once the avatar video actually begins playing (gates session start). */
  onVideoReady?: () => void;
  /** Fires if the Anam WebRTC connection drops. */
  onConnectionClosed?: (reason?: unknown) => void;
  /**
   * Fires when the current talk stream ends or is interrupted.
   * Use this to unlock the microphone early rather than waiting for the
   * word-count fallback timer — Anam has no dedicated "stopped speaking" event,
   * but TALK_STREAM_INTERRUPTED fires reliably when the avatar finishes a turn.
   */
  onTalkStreamInterrupted?: () => void;
}

/** Resolve once the target element exists in the DOM (or reject after ~1s). */
function waitForElement(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve();
    let tries = 0;
    const check = () => {
      if (document.getElementById(id)) return resolve();
      if (tries++ > 60) return reject(new Error(`avatar video element #${id} never mounted`));
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export class AnamController {
  private client: AnamClient | null = null;

  /** Create the client, wire events, and start streaming into the video element. */
  async init(opts: AnamInitOptions): Promise<void> {
    const { createClient, AnamEvent } = await import('@anam-ai/js-sdk');

    const client = createClient(opts.sessionToken);
    this.client = client;

    if (opts.onVideoReady) {
      // VIDEO_PLAY_STARTED is the authoritative "avatar is now on screen" signal.
      client.addListener(AnamEvent.VIDEO_PLAY_STARTED, opts.onVideoReady);
    }
    if (opts.onConnectionClosed) {
      client.addListener(AnamEvent.CONNECTION_CLOSED, opts.onConnectionClosed);
    }
    if (opts.onTalkStreamInterrupted) {
      // TALK_STREAM_INTERRUPTED fires when the avatar finishes (or is cut short)
      // speaking a turn — use it to unlock the microphone early instead of
      // waiting for the word-count fallback timer.
      client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, opts.onTalkStreamInterrupted);
    }

    // Ensure the <video> is mounted before the SDK looks it up by id.
    await waitForElement(opts.videoElementId);
    await client.streamToVideoElement(opts.videoElementId);
  }

  /** Echo mode: make the persona speak the exact provided text. */
  async talk(text: string): Promise<void> {
    if (!this.client) return;
    await this.client.talk(text);
  }

  isActive(): boolean {
    return this.client !== null;
  }

  /** Tear down the stream and release the client. Safe to call repeatedly. */
  async cleanup(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.stopStreaming();
    } catch {
      /* already stopped / never started */
    }
  }
}
