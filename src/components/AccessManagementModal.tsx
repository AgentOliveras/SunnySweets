import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  X,
  FolderPlus,
  Trash2,
  RefreshCw,
  Mail,
  UserCheck,
  Building2,
  Layers,
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
  onJoinByCode?: (code: string) => Promise<boolean>;
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
  onCreateWorkspace,
  onSwitchWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<'people' | 'groups'>('people');

  // Add Member State
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<AccessRole>('editor');

  // Add Group State
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmails, setNewGroupEmails] = useState('');
  const [newGroupRole, setNewGroupRole] = useState<AccessRole>('editor');

  // New Workspace State
  const [isCreatingWs, setIsCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState('');

  if (!isOpen) return null;

  const currentMembers: AccessMember[] = activeWorkspace?.members || [];
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

  const handleCreateWorkspaceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    onCreateWorkspace(newWsName.trim());
    setNewWsName('');
    setIsCreatingWs(false);
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
                  Workspace Access Management
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Owner-Governed Zero-Trust
                </span>
              </div>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Explicitly grant or revoke access roles for verified team members and groups.
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
                    {ws.name} ({ws.members?.length || 0} members)
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
                  <span>Grant Explicit Access to a Person</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <input
                      type="email"
                      required
                      placeholder="Verified Google Email..."
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

                  <div className="sm:col-span-3 flex gap-1.5">
                    <select
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value as AccessRole)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl font-bold text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none focus:border-[#D4A373]"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="owner">Owner</option>
                    </select>

                    <button
                      type="submit"
                      className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-3 py-1.5 rounded-xl text-xs transition cursor-pointer shadow-xs shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Users must sign in with Google using this verified email to access this workspace.
                </p>
              </form>

              {/* Members List */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] uppercase tracking-wider">
                  Current Authorized Members ({currentMembers.length})
                </span>

                <div className="divide-y divide-[#EEECE8] dark:divide-[#332F2B] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl overflow-hidden">
                  {currentMembers.map((member) => (
                    <div
                      key={member.email}
                      className="p-3 bg-white dark:bg-[#1E1B18] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-[#FAF3E0] dark:bg-[#2C2416] text-[#C49363] flex items-center justify-center font-bold text-xs shrink-0">
                          {member.name ? member.name[0].toUpperCase() : member.email[0].toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1.5">
                            <span className="truncate">{member.name || member.email.split('@')[0]}</span>
                            {currentUserEmail && member.email.toLowerCase() === currentUserEmail.toLowerCase() && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#8B7E74] truncate flex items-center gap-1">
                            <Mail className="w-3 h-3 text-[#A39E93]" />
                            <span>{member.email}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={member.role}
                          onChange={(e) => onUpdateMemberRole(member.email, e.target.value as AccessRole)}
                          className="px-2 py-1 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg font-bold text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="owner">Owner</option>
                        </select>

                        <button
                          onClick={() => onRemoveMember(member.email)}
                          className="p-1.5 text-[#C97B63] hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                          title="Remove Access"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                  <span>Create Team Access Group</span>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-8">
                      <input
                        type="text"
                        required
                        placeholder="Group name (e.g. Morning Shift Bakers, Quality Control)"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <select
                        value={newGroupRole}
                        onChange={(e) => setNewGroupRole(e.target.value as AccessRole)}
                        className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl font-bold text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none"
                      >
                        <option value="viewer">Viewer (Read-only)</option>
                        <option value="editor">Editor (Full editing)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Member emails separated by comma (e.g. alice@bakery.com, bob@bakery.com)"
                      value={newGroupEmails}
                      onChange={(e) => setNewGroupEmails(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <button
                    type="submit"
                    className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-1.5 rounded-xl text-xs transition cursor-pointer shadow-xs"
                  >
                    Create Group
                  </button>
                </div>
              </form>

              {/* Groups List */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] uppercase tracking-wider">
                  Configured Groups ({currentGroups.length})
                </span>

                {currentGroups.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#8B7E74] border border-dashed border-[#EEECE8] dark:border-[#332F2B] rounded-xl">
                    No access groups created yet. Create a group to assign roles to multiple team members at once.
                  </div>
                ) : (
                  <div className="divide-y divide-[#EEECE8] dark:divide-[#332F2B] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl overflow-hidden">
                    {currentGroups.map((group) => (
                      <div
                        key={group.id}
                        className="p-3 bg-white dark:bg-[#1E1B18] flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
                            <span>{group.name}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF3E0] dark:bg-[#2C2416] text-[#C49363] uppercase">
                              {group.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8B7E74] mt-0.5">
                            {group.memberEmails.length} members: {group.memberEmails.join(', ')}
                          </div>
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
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] bg-[#FBF9F5] dark:bg-[#25221F] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#8B7E74]">
            <RefreshCw className="w-3.5 h-3.5 text-[#D4A373]" />
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
