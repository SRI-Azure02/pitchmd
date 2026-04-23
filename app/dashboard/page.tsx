'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import ChatInterface from '@/components/chat-interface';
import { Settings, User, ChevronDown, LogOut, Map, Camera, Monitor, Scan, X } from 'lucide-react';

const ROADMAP_ITEMS = [
  {
    icon: <Scan className="w-5 h-5" />,
    title: 'Document Camera Scanner',
    description: 'Hold a document up to your device camera and instantly extract its contents for use during a call or session.',
    status: 'Planned',
  },
  {
    icon: <Monitor className="w-5 h-5" />,
    title: 'Screen Content Reader',
    description: 'Trigger an on-demand screen capture so PitchMD can read and reference what\'s currently on your screen.',
    status: 'Planned',
  },
  {
    icon: <Camera className="w-5 h-5" />,
    title: 'Facial & Body Language Feedback',
    description: 'Use your device camera to analyse facial expressions and body language in real time, with coaching feedback on your non-verbal presentation.',
    status: 'Planned',
  },
];

interface Session {
  userId: string;
  username: string;
  email: string;
}

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const roadmapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  // Close dropdown / roadmap on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (roadmapRef.current && !roadmapRef.current.contains(e.target as Node)) {
        setRoadmapOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setSession({ userId: data.userId, username: data.username, email: data.email ?? '' });
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F1EFE9] flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  // First name only for the button label
  const firstName = session?.username?.split(' ')[0] ?? 'User';

  return (
    <div className="h-screen bg-[#F1EFE9] flex flex-col overflow-hidden">
      <div className="flex flex-col flex-1 w-full min-h-0">

        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-4 mb-3 shrink-0">
          <div>
            <h1 style={{
              fontSize: '28px',
              background: 'linear-gradient(90deg, #FF6B00, #00C8FF, #FF6B00)',
              backgroundSize: '300% 300%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'gradientShift 6s ease infinite',
            }} className="font-semibold">PitchMD™</h1>
            <p className="mt-0.5 font-medium tracking-widest text-slate-900 uppercase" style={{ fontSize: '11px' }}>Strategic Research Insights, Inc.</p>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">

            {/* Roadmap */}
            <div className="relative" ref={roadmapRef}>
              <button
                onClick={() => setRoadmapOpen(prev => !prev)}
                title="Product Roadmap"
                className={`p-1.5 rounded-md transition-colors ${
                  roadmapOpen
                    ? 'text-orange-500 bg-orange-50'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Map className="w-4 h-4" />
              </button>

              {roadmapOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Product Roadmap</p>
                      <p className="text-xs text-slate-400 mt-0.5">Features coming soon</p>
                    </div>
                    <button
                      onClick={() => setRoadmapOpen(false)}
                      className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-slate-50">
                    {ROADMAP_ITEMS.map((item, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                        <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-slate-100 text-slate-500">
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-800 leading-snug">{item.title}</p>
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
                              {item.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 leading-relaxed">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <Settings className="w-4 h-4" />
            </button>

            {/* User dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 border transition-colors ${
                  dropdownOpen
                    ? 'border-orange-400 bg-white'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <User className="w-4 h-4 text-slate-400" />
                <span>{firstName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-lg shadow-lg border border-slate-100 py-1 z-50">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800">{session?.username}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{session?.email}</p>
                  </div>
                  {/* Log out */}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat — full width, fills remaining height */}
        <Card className="p-0 bg-white flex flex-col flex-1 min-h-0 overflow-hidden rounded-none border-x-0 border-b-0">
          <ChatInterface username={session?.username ?? 'Rep'} />
        </Card>

      </div>
    </div>
  );
}
