'use client';

import { Camera, ShieldCheck, Trash2, ToggleLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CameraConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export default function CameraConsentModal({ open, onAccept, onDecline }: CameraConsentModalProps) {
  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: '1rem' }}
      onClick={onDecline}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4"
        style={{ maxWidth: '28rem' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-slate-100">
              <Camera className="w-4 h-4 text-slate-600" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Optional Feature</span>
          </div>
          <p className="text-lg font-bold text-slate-900">Facial Expression Analysis</p>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed">
          PitchMD can analyse your facial expressions during this session and include a <strong>Confidence</strong>, <strong>Nervousness</strong>, and <strong>Engagement</strong> assessment in your evaluation report.
        </p>

        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">No video is stored.</span> Periodic still frames are sent to an AI model for analysis only. The frames are not retained after analysis completes.
            </p>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <ToggleLeft className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">You can turn it off at any time.</span> A camera button in the session toolbar lets you disable capture mid-session. If you do, that section of your report will be left blank.
            </p>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <Trash2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">Consent is per-session.</span> You will be asked each time you start a new session.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-2">
          <Button
            onClick={onAccept}
            className="flex-1 bg-slate-900 hover:bg-slate-700 text-white"
          >
            <Camera className="w-3.5 h-3.5 mr-2" />
            Enable Camera
          </Button>
          <Button
            variant="outline"
            onClick={onDecline}
            className="flex-1 text-slate-600"
          >
            Continue Without Camera
          </Button>
        </div>
      </div>
    </div>
  );
}
