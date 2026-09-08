'use strict';
'use client';

import React, { useEffect, useState } from 'react';

export default function CredentialsPage() {
  const [currentUsername, setCurrentUsername] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Username form state
  const [newUsername, setNewUsername] = useState('');
  const [usernameCurrentPassword, setUsernameCurrentPassword] = useState('');
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Password form state
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.company) {
            setCurrentUsername(json.data.company.username);
          }
        }
      } catch (e) {
        console.error('Failed to load profile for credentials:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMe();
  }, []);

  const handleUpdateUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(null);

    if (!newUsername.trim()) {
      setUsernameError('Please provide a new username');
      return;
    }
    if (newUsername.trim() === currentUsername) {
      setUsernameError('New username must be different from current username');
      return;
    }
    if (!usernameCurrentPassword) {
      setUsernameError('Current password is required to change username');
      return;
    }

    setIsUpdatingUsername(true);

    try {
      const res = await fetch('/api/company/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: usernameCurrentPassword,
          new_username: newUsername.trim(),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentUsername(data.data.company.username);
        setNewUsername('');
        setUsernameCurrentPassword('');
        setUsernameSuccess('Username changed successfully. Your session has been updated.');
      } else {
        setUsernameError(data.error || 'Failed to update username');
      }
    } catch {
      setUsernameError('Unable to connect to server. Please try again.');
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!passwordCurrentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const res = await fetch('/api/company/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: passwordCurrentPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setPasswordCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordSuccess('Password changed successfully. Your new credentials are now active.');
      } else {
        setPasswordError(data.error || 'Failed to update password');
      }
    } catch {
      setPasswordError('Unable to connect to server. Please try again.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-8 text-center text-white/50">
        Loading credentials...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-[#2A2A4A] pb-4">
        <h1 className="text-2xl font-bold text-white">Login Credentials</h1>
        <p className="text-sm text-white/50 mt-1">
          Manage shared company login credentials used across mobile scanning devices.
        </p>
      </div>

      {/* Section 1: Change Username */}
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10 text-[#FF8C00]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Change Username</h2>
              <p className="text-xs text-white/50">Current Username: <span className="font-mono text-[#FF8C00] font-bold">{currentUsername}</span></p>
            </div>
          </div>

          {usernameSuccess && (
            <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 flex items-center gap-2.5 text-xs text-emerald-200">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{usernameSuccess}</span>
            </div>
          )}

          {usernameError && (
            <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3.5 flex items-center gap-2.5 text-xs text-red-200">
              <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{usernameError}</span>
            </div>
          )}

          <form onSubmit={handleUpdateUsername} className="mt-5 space-y-4">
            <div>
              <label htmlFor="newUsername" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                New Username
              </label>
              <input
                id="newUsername"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. ABC2026"
                className="mt-1.5 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#FF8C00] transition"
              />
            </div>

            <div>
              <label htmlFor="usernameCurrentPassword" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                Current Password <span className="text-[#FF8C00]">*</span>
              </label>
              <input
                id="usernameCurrentPassword"
                type="password"
                required
                value={usernameCurrentPassword}
                onChange={(e) => setUsernameCurrentPassword(e.target.value)}
                placeholder="Enter current password to authorize change"
                className="mt-1.5 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#FF8C00] transition"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isUpdatingUsername}
                className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
              >
                {isUpdatingUsername ? 'UPDATING...' : 'CHANGE USERNAME'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Section 2: Change Password */}
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/10 text-red-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Change Password</h2>
              <p className="text-xs text-white/50">Passwords are cryptographically hashed using salted bcrypt (12 rounds).</p>
            </div>
          </div>

          {passwordSuccess && (
            <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 flex items-center gap-2.5 text-xs text-emerald-200">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{passwordSuccess}</span>
            </div>
          )}

          {passwordError && (
            <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3.5 flex items-center gap-2.5 text-xs text-red-200">
              <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="mt-5 space-y-4">
            <div>
              <label htmlFor="passwordCurrentPassword" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                Current Password <span className="text-red-400">*</span>
              </label>
              <input
                id="passwordCurrentPassword"
                type="password"
                required
                value={passwordCurrentPassword}
                onChange={(e) => setPasswordCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="mt-1.5 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-red-400 transition"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                New Password <span className="text-red-400">*</span>
              </label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="mt-1.5 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-red-400 transition"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                Confirm New Password <span className="text-red-400">*</span>
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password exactly"
                className="mt-1.5 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-red-400 transition"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-red-500 to-rose-600 hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
              >
                {isUpdatingPassword ? 'UPDATING...' : 'CHANGE PASSWORD'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
