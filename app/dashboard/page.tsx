'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import ChatInterface from '@/components/chat-interface';
import { Settings, User, ChevronDown, LogOut } from 'lucide-react';

interface Session {
  userId: string;
  username: string;
  email: string;
}

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
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
