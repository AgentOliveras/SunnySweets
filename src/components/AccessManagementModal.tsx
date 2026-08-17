import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  X,
  Copy,
  Check,
  Key,
  FolderPlus,
  Trash2,
  RefreshCw,
  Mail,
  UserCheck,
  Building2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Workspace, AccessRole, AccessMember, AccessGroup } from '../types';

interface AccessManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  currentUserEmail: string | null;
  onSaveWorkspace: (ws: Workspace) => void;
  onAddMember: (email: string, role: AccessRole, name?: string) => void;
  onRemoveMember: (email: string) => void;
  onUpdateMemberRole: (email: string, role: AccessRole) => void;
  onAddGroup: (name: string, emails: string[], role: AccessRole) => void;
  onRemoveGroup: (groupId: string) => void;
  onJoinByCode: (code: string) => Promise<boolean>;
  onCreateWorkspace: (name: string) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
}

export const AccessManagementModal: React.FC<AccessManagementModalProps> = ({
  isOpen,
  onClose,
  workspaces,
  activeWorkspace,
  currentUserEmail,
  onAddMember,
  onRemoveMember,
  onUpdateMemberRole,
  onAddGroup,
  onRemoveGroup,
  onJoinByCode,
  onCreateWorkspace,
  onSwitchWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<'people' | 'groups' | 'join'>('people');

  // Add Member State
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<AccessRole>('editor');

  // Add Group State
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmails, setNewGroupEmails] = useState('');
  const [newGroupRole, setNewGroupRole] = useState<AccessRole>('editor');

  // Join Code State
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinMessage, setJoinMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Workspace State
  const [isCreatingWs, setIsCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState('');

  // Copy state
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const currentMembers: AccessMember[] = activeWorkspace?.members || [
    {
      email: currentUserEmail || 'owner@bakery.com',
      name: 'Primary Owner',
      role: 'owner',
      addedAt: new Date().toISOString(),
    },
  ];

  const currentGroups: AccessGroup[] = activeWorkspace?.groups || [];

  const handleAddMemberSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) return;
    onAddMember(newMemberEmail.trim().toLowerCase(), newMemberRole, newMemberName.trim());
    setNewMemberEmail('');
    setNewMemberName('');
  };

  const handleAddGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const emailList = newGroupEmails
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    onAddGroup(newGroupName.trim(), emailList, newGroupRole);
    setNewGroupName('');
    setNewGroupEmails('');
  };

  const handleJoinByCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setJoinMessage(null);
    const success = await onJoinByCode(joinCodeInput.trim().toUpperCase());
    if (success) {
      setJoinMessage({ type: 'success', text: 'Successfully joined workspace! Auto-sync is now active.' });
      setJoinCodeInput('');
    } else {
      setJoinMessage({ type: 'error', text: 'Invalid or expired share code. Please double-check and try again.' });
    }
  };

  const handleCreateWorkspaceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    onCreateWorkspace(newWsName.trim());
    setNewWsName('');
    setIsCreatingWs(false);
  };

  const copyShareCode = () => {
    if (!activeWorkspace?.code) return;
    navigator.clipboard.writeText(activeWorkspace.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0 bg-[#FBF9F5] dark:bg-[#25221F]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4A373]/20 dark:bg-[#D4A373]/30 flex items-center justify-center text-[#D4A373]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  People & Groups with Access
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Realtime Sync Active
                </span>
              </div>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Changes sync automatically across all invited users and team groups.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Switcher Bar */}
        <div className="p-3 bg-[#F5F2ED] dark:bg-[#1E1B18] border-b border-[#EEECE8] dark:border-[#332F2B] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#D4A373]" />
            <span className="font-bold text-[#8B7E74] dark:text-[#A39E93]">Workspace:</span>
            {isCreatingWs ? (
              <form onSubmit={handleCreateWorkspaceSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="New workspace name..."
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="px-2 py-1 text-xs bg-white dark:bg-[#25221F] border border-[#D4A373] rounded-lg focus:outline-none dark:text-[#EAE6E1]"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 bg-[#D4A373] text-white font-bold rounded-lg hover:bg-[#C49363]"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingWs(false)}
                  className="px-2 py-1 text-[#8B7E74]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <select
                value={activeWorkspace?.id || ''}
                onChange={(e) => onSwitchWorkspace(e.target.value)}
                className="bg-white dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold px-3 py-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] focus:outline-none focus:border-[#D4A373] cursor-pointer"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} ({ws.members?.length || 1} members)
                  </option>
                ))}
              </select>
            )}
          </div>

          {!isCreatingWs && (
            <button
              onClick={() => setIsCreatingWs(true)}
              className="inline-flex items-center gap-1 text-[#D4A373] hover:text-[#C49363] font-bold text-xs cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>+ New Workspace</span>
            </button>
          )}
        </div>

        {/* Tab Selection Bar */}
        <div className="flex border-b border-[#EEECE8] dark:border-[#332F2B] px-4 pt-2 bg-white dark:bg-[#1E1B18] shrink-0">
          <button
            onClick={() => setActiveTab('people')}
            className={`pb-2 px-4 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'people'
                ? 'border-[#D4A373] text-[#D4A373]'
                : 'border-transparent text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>People ({currentMembers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`pb-2 px-4 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'groups'
                ? 'border-[#D4A373] text-[#D4A373]'
                : 'border-transparent text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Access Groups ({currentGroups.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('join')}
            className={`pb-2 px-4 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'join'
                ? 'border-[#D4A373] text-[#D4A373]'
                : 'border-transparent text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Share Code & Join</span>
          </button>
        </div>

        {/* Main Tab Content */}
        <div className="p-5 space-y-6 overflow-y-auto flex-1">
          {/* TAB 1: PEOPLE WITH ACCESS */}
          {activeTab === 'people' && (
            <div className="space-y-5">
              {/* Add Member Form */}
              <form
                onSubmit={handleAddMemberSubmit}
                className="bg-[#FBF9F5] dark:bg-[#25221F] p-3.5 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                  <UserPlus className="w-4 h-4 text-[#D4A373]" />
                  <span>Grant Access to a Person</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <input
                      type="email"
                      required
                      placeholder="Email address (e.g. baker@bakery.com)"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <input
                      type="text"
                      placeholder="Name (optional)"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value as AccessRole)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer font-medium"
                    >
                      <option value="editor">Editor (Can edit)</option>
                      <option value="viewer">Viewer (Read only)</option>
                      <option value="owner">Owner (Full control)</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-1.5 rounded-xl text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Grant Access & Sync</span>
                  </button>
                </div>
              </form>

              {/* Members List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase tracking-wider">
                  Active Team Members ({currentMembers.length})
                </h4>

                <div className="divide-y divide-[#EEECE8] dark:divide-[#332F2B] bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl overflow-hidden">
                  {currentMembers.map((member) => (
                    <div
                      key={member.email}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-[#FBF9F5] dark:hover:bg-[#25221F] transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] flex items-center justify-center text-[#5A534B] dark:text-[#EAE6E1] font-bold text-xs shrink-0">
                          {member.name ? member.name.charAt(0).toUpperCase() : member.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1] truncate">
                              {member.name || member.email}
                            </span>
                            {member.email === currentUserEmail && (
                              <span className="text-[10px] font-bold text-[#D4A373] bg-[#F5F2ED] dark:bg-[#25221F] px-1.5 py-0.5 rounded">
                                You
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] block truncate">
                            {member.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={member.role}
                          disabled={member.role === 'owner' && member.email === currentUserEmail}
                          onChange={(e) => onUpdateMemberRole(member.email, e.target.value as AccessRole)}
                          className="px-2 py-1 text-[11px] font-bold rounded-lg bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none cursor-pointer"
                        >
                          <option value="owner">Owner</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>

                        {member.email !== currentUserEmail && (
                          <button
                            onClick={() => onRemoveMember(member.email)}
                            className="p-1.5 text-[#C97B63] hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                            title="Revoke Access"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACCESS GROUPS */}
          {activeTab === 'groups' && (
            <div className="space-y-5">
              {/* Add Group Form */}
              <form
                onSubmit={handleAddGroupSubmit}
                className="bg-[#FBF9F5] dark:bg-[#25221F] p-3.5 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                  <Layers className="w-4 h-4 text-[#D4A373]" />
                  <span>Create Access Group (e.g. Kitchen Staff, Morning Shift)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      required
                      placeholder="Group Name (e.g. Morning Bakers)"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <input
                      type="text"
                      placeholder="Emails (comma separated)"
                      value={newGroupEmails}
                      onChange={(e) => setNewGroupEmails(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      value={newGroupRole}
                      onChange={(e) => setNewGroupRole(e.target.value as AccessRole)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer font-medium"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-1.5 rounded-xl text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>Create Access Group</span>
                  </button>
                </div>
              </form>

              {/* Group List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase tracking-wider">
                  Access Groups ({currentGroups.length})
                </h4>

                {currentGroups.length === 0 ? (
                  <div className="text-center py-8 text-xs text-[#A39E93] bg-white dark:bg-[#1E1B18] rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-4">
                    No custom access groups created yet. Group members together for easy role permissions.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {currentGroups.map((group) => (
                      <div
                        key={group.id}
                        className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-serif font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                              {group.name}
                            </span>
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] border border-[#EEECE8] dark:border-[#332F2B]">
                              {group.role}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                            {group.memberEmails.length > 0
                              ? `Members: ${group.memberEmails.join(', ')}`
                              : 'No emails assigned to group yet'}
                          </p>
                        </div>

                        <button
                          onClick={() => onRemoveGroup(group.id)}
                          className="p-1.5 text-[#C97B63] hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                          title="Delete Group"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SHARE CODE & JOIN */}
          {activeTab === 'join' && (
            <div className="space-y-6">
              {/* Share Code Section */}
              <div className="bg-[#FBF9F5] dark:bg-[#25221F] p-4 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-[#D4A373]" />
                    <span>Workspace Share Code</span>
                  </span>
                  <span className="text-[10px] text-[#8B7E74]">Share code with team members to sync instantly</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="bg-white dark:bg-[#1E1B18] px-4 py-2 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] font-mono text-base font-extrabold text-[#D4A373] tracking-widest select-all">
                    {activeWorkspace?.code || 'BAKERY-SYNC'}
                  </div>

                  <button
                    onClick={copyShareCode}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#D4A373] text-white rounded-xl text-xs font-bold hover:bg-[#C49363] transition cursor-pointer shadow-sm"
                  >
                    {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                </div>
              </div>

              {/* Join Workspace Form */}
              <form onSubmit={handleJoinByCodeSubmit} className="space-y-3 pt-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                  <Sparkles className="w-4 h-4 text-[#D4A373]" />
                  <span>Join Another Workspace by Code</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Enter Share Code (e.g. BAKERY-79A1)..."
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs font-mono tracking-wider uppercase bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />

                  <button
                    type="submit"
                    className="bg-[#5A534B] hover:bg-[#4A443E] dark:bg-[#3D3732] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
                  >
                    Join & Sync
                  </button>
                </div>

                {joinMessage && (
                  <p
                    className={`text-xs p-2 rounded-lg font-medium ${
                      joinMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                    }`}
                  >
                    {joinMessage.text}
                  </p>
                )}
              </form>

              {/* Automatic Realtime Sync Info Banner */}
              <div className="p-3.5 bg-[#F5F2ED] dark:bg-[#25221F] rounded-xl border border-[#EEECE8] dark:border-[#332F2B] text-xs text-[#8B7E74] dark:text-[#A39E93] space-y-1">
                <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#D4A373]" />
                  <span>Automatic Firestore Synchronization Engine</span>
                </div>
                <p>
                  All recipes, ingredient inventory, equipment mixers, production presets, and batch histories update in real-time across every browser session and device connected to this workspace.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] bg-[#FBF9F5] dark:bg-[#25221F] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#8B7E74]">
            <RefreshCw className="w-3.5 h-3.5 text-[#D4A373] animate-spin-slow" />
            <span>Syncing via Cloud Firestore</span>
          </div>

          <button
            onClick={onClose}
            className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
