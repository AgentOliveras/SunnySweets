import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  Crown,
  Eye,
  Edit3,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Lock,
  CheckCircle2,
  UserCheck,
  X,
  Mail,
  Fingerprint,
  Calendar,
} from 'lucide-react';
import { store } from '../services/store';
import { auth } from '../services/firebase';
import { WorkspaceMemberDoc, AccessRole } from '../types';

interface MembersManagementProps {
  onSuccessNotice?: (message: string) => void;
}

export const MembersManagement: React.FC<MembersManagementProps> = ({ onSuccessNotice }) => {
  const [members, setMembers] = useState<WorkspaceMemberDoc[]>(() => store.getWorkspaceMembers() || []);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  // Add Member Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUid, setAddUid] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState<'editor' | 'viewer'>('editor');
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Member Modal State
  const [editingMember, setEditingMember] = useState<WorkspaceMemberDoc | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'editor' | 'viewer'>('editor');
  const [editActive, setEditActive] = useState(true);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Remove Confirmation State
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMemberDoc | null>(null);
  const [isSubmittingRemove, setIsSubmittingRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Reactive role & workspace state
  const [currentRole, setCurrentRole] = useState<AccessRole | null>(() => store.getUserRole());
  const isOwner = currentRole === 'owner';
  const currentUser = auth.currentUser;
  const activeWorkspace = store.getActiveWorkspace();
  const activeWorkspaceId = activeWorkspace?.id || 'ws-main';

  // Sync members and user role from store
  useEffect(() => {
    const updateMembersFromStore = () => {
      setCurrentRole(store.getUserRole());
      const storeMembers = store.getWorkspaceMembers();
      if (Array.isArray(storeMembers)) {
        setMembers(storeMembers);
      }
    };

    updateMembersFromStore();
    const unsubscribe = store.subscribe(updateMembersFromStore);

    // Initial direct fetch
    handleRefresh();

    return () => {
      unsubscribe();
    };
  }, [activeWorkspaceId]);

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      setFetchError(null);
      const fetched = await store.fetchWorkspaceMembersDirect(activeWorkspaceId);
      if (Array.isArray(fetched)) {
        setMembers(fetched);
      } else {
        setFetchError('Unable to load workspace members. Please try again.');
      }
    } catch (err: any) {
      console.warn('Members fetch notice:', err);
      setFetchError('Unable to load workspace members. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (uid: string) => {
    if (!uid) return;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(uid).catch(() => {});
      }
    } catch (err) {
      console.warn('Clipboard write error:', err);
    }
    setCopiedUid(uid);
    setTimeout(() => {
      setCopiedUid(null);
    }, 2000);
  };

  const getMemberInitial = (member: WorkspaceMemberDoc): string => {
    if (member?.name && typeof member.name === 'string' && member.name.trim().length > 0) {
      return member.name.trim().charAt(0).toUpperCase();
    }
    if (member?.email && typeof member.email === 'string' && member.email.trim().length > 0) {
      return member.email.trim().charAt(0).toUpperCase();
    }
    return 'M';
  };

  const getMemberDisplayName = (member: WorkspaceMemberDoc): string => {
    if (member?.name && typeof member.name === 'string' && member.name.trim().length > 0) {
      return member.name.trim();
    }
    if (member?.email && typeof member.email === 'string' && member.email.includes('@')) {
      return member.email.split('@')[0] || 'Member';
    }
    return member?.email || 'Member';
  };

  const resetAddForm = () => {
    setAddUid('');
    setAddEmail('');
    setAddName('');
    setAddRole('editor');
    setAddError(null);
  };

  const handleOpenAdd = () => {
    resetAddForm();
    setShowAddModal(true);
  };

  const handleCloseAdd = () => {
    setShowAddModal(false);
    resetAddForm();
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    const cleanUid = addUid.trim();
    const cleanEmail = addEmail.toLowerCase().trim();
    const cleanName = addName.trim();

    if (!cleanUid) {
      setAddError('Firebase UID is required. The user can copy it from their Account Not Authorized screen.');
      return;
    }
    if (cleanUid.length < 5 || cleanUid.includes(' ') || cleanUid.includes('/')) {
      setAddError('Invalid Firebase UID format: Must be at least 5 characters with no spaces or slashes.');
      return;
    }

    if (!cleanEmail) {
      setAddError('Email address is required.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setAddError('Please enter a valid email address format.');
      return;
    }

    if (cleanUid === currentUser?.uid) {
      setAddError('Cannot add yourself as an editor or viewer. You are the workspace owner.');
      return;
    }

    try {
      setIsSubmittingAdd(true);
      await store.addWorkspaceMember({
        uid: cleanUid,
        email: cleanEmail,
        name: cleanName || cleanEmail.split('@')[0],
        role: addRole,
        active: true,
      });

      handleCloseAdd();
      if (onSuccessNotice) {
        onSuccessNotice(`Member ${cleanEmail} successfully added as ${addRole}. They can now click "Check Access Again".`);
      }
    } catch (err: any) {
      setAddError(err.message || 'Failed to add member.');
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  const handleOpenEdit = (member: WorkspaceMemberDoc) => {
    if (member.role === 'owner') return;
    setEditingMember(member);
    setEditName(member.name);
    setEditRole(member.role === 'viewer' ? 'viewer' : 'editor');
    setEditActive(member.active !== false);
    setEditError(null);
  };

  const handleCloseEdit = () => {
    setEditingMember(null);
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setEditError(null);

    try {
      setIsSubmittingEdit(true);
      await store.updateWorkspaceMember(editingMember.uid, {
        name: editName.trim() || editingMember.name,
        role: editRole,
        active: editActive,
      });

      handleCloseEdit();
      if (onSuccessNotice) {
        onSuccessNotice(`Member ${editingMember.email} updated successfully.`);
      }
    } catch (err: any) {
      setEditError(err.message || 'Failed to update member.');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleQuickToggleActive = async (member: WorkspaceMemberDoc) => {
    if (!isOwner || member.role === 'owner' || member.uid === currentUser?.uid) return;
    try {
      const newActive = !member.active;
      await store.updateWorkspaceMember(member.uid, {
        active: newActive,
      });
      if (onSuccessNotice) {
        onSuccessNotice(`Member ${member.email} ${newActive ? 'activated' : 'deactivated'}.`);
      }
    } catch (err: any) {
      alert(`Status update failed: ${err.message || String(err)}`);
    }
  };

  const handleOpenRemove = (member: WorkspaceMemberDoc) => {
    if (member.role === 'owner' || member.uid === currentUser?.uid) return;
    setMemberToRemove(member);
    setRemoveError(null);
  };

  const handleCloseRemove = () => {
    setMemberToRemove(null);
    setRemoveError(null);
  };

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return;
    try {
      setIsSubmittingRemove(true);
      setRemoveError(null);
      await store.removeWorkspaceMember(memberToRemove.uid);
      const email = memberToRemove.email;
      handleCloseRemove();
      if (onSuccessNotice) {
        onSuccessNotice(`Member ${email} removed from workspace.`);
      }
    } catch (err: any) {
      setRemoveError(err.message || 'Failed to remove member.');
    } finally {
      setIsSubmittingRemove(false);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#EEECE8] dark:border-[#2D2925]">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#D4A373] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Members & Access
              </h3>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] border border-[#EEECE8] dark:border-[#332F2B]">
                {activeWorkspaceId}
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
              Strict UID-based workspace access control. Manage authorized team members and permission levels.
            </p>
          </div>
        </div>

        {/* Action Controls & Role Badge */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Current User Role Pill */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
            {currentRole === 'owner' ? (
              <>
                <Crown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-amber-800 dark:text-amber-300 font-bold">Workspace Owner</span>
              </>
            ) : currentRole === 'editor' ? (
              <>
                <Edit3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-blue-800 dark:text-blue-300 font-bold">Editor Role</span>
              </>
            ) : currentRole === 'viewer' ? (
              <>
                <Eye className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                <span className="text-slate-800 dark:text-slate-300 font-bold">Viewer Role</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#8B7E74]" />
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Checking Access...</span>
              </>
            )}
          </div>

          {/* Refresh Roster Button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh member roster"
            className="p-2 rounded-lg bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#D4A373]' : ''}`} />
          </button>

          {/* Add Member Button (Owner only) */}
          {isOwner && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold rounded-lg shadow-sm transition cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Member</span>
            </button>
          )}
        </div>
      </div>

      {/* Visible Error Panel for Member Data Failure */}
      {fetchError && (
        <div className="p-4 rounded-xl bg-red-50/80 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="font-medium">Unable to load workspace members. Please try again.</span>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-[#1E1B18] border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold rounded-lg shadow-2xs transition self-start sm:self-auto cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Non-Owner Informational Notice */}
      {!isOwner && currentRole && (
        <div className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/30 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
          <Shield className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Read-Only Access: </span>
            You are authorized as an {currentRole === 'editor' ? 'Editor' : 'Viewer'} in this workspace. Only workspace Owners have permission to add, modify, or remove member credentials.
          </div>
        </div>
      )}

      {/* Members Roster Table / Card List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-[#8B7E74] dark:text-[#A39E93]">
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            Authorized Members ({members.length})
          </span>
          <span className="text-[11px]">
            Authoritative source: <code className="font-mono text-[10px]">workspaces/{activeWorkspaceId}/members</code>
          </span>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] bg-[#FAF8F5] dark:bg-[#1A1816] space-y-2">
            <UserCheck className="w-8 h-8 text-[#8B7E74] mx-auto opacity-50" />
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
              No authorized members found in this workspace.
            </p>
            {isOwner && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#D4A373] text-white text-xs font-bold rounded-lg hover:bg-[#C49363] transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add First Member</span>
              </button>
            )}
          </div>
        ) : (
          <div className="border border-[#EEECE8] dark:border-[#2D2925] rounded-xl overflow-hidden divide-y divide-[#EEECE8] dark:divide-[#2D2925]">
            {members.map((member) => {
              const isCurrentMemberUser = member.uid === currentUser?.uid;
              const isMemberOwner = member.role === 'owner';

              return (
                <div
                  key={member.uid}
                  className={`p-4 transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    !member.active
                      ? 'bg-zinc-50/70 dark:bg-zinc-950/20 opacity-75'
                      : isCurrentMemberUser
                      ? 'bg-amber-50/20 dark:bg-amber-950/10'
                      : 'bg-white dark:bg-[#1E1B18] hover:bg-[#FAF9F7] dark:hover:bg-[#23201D]'
                  }`}
                >
                  {/* Member Info */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    {/* Avatar Initials Circle */}
                    <div
                      className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center font-bold text-xs border ${
                        isMemberOwner
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                          : member.role === 'editor'
                          ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {getMemberInitial(member)}
                    </div>

                    {/* Name, Email, and You tag */}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-[#5A534B] dark:text-[#EAE6E1] truncate">
                          {getMemberDisplayName(member)}
                        </span>
                        {isCurrentMemberUser && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 bg-[#D4A373]/20 text-[#8A5A2B] dark:text-[#D4A373] rounded">
                            You
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                        <Mail className="w-3 h-3 shrink-0" />
                        <span className="truncate">{member.email || 'No email registered'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Metadata & Badges */}
                  <div className="flex items-center flex-wrap gap-2.5 sm:gap-4 self-start md:self-auto text-xs">
                    {/* Role Badge */}
                    <div>
                      {member.role === 'owner' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800">
                          <Crown className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          <span>Owner</span>
                        </span>
                      ) : member.role === 'editor' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Edit3 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          <span>Editor</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          <Eye className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                          <span>Viewer</span>
                        </span>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div>
                      {member.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          <span>Inactive</span>
                        </span>
                      )}
                    </div>

                    {/* UID Copyable Pill */}
                    <div className="flex items-center gap-1 bg-[#FAF8F5] dark:bg-[#25221F] px-2 py-1 rounded-md border border-[#EEECE8] dark:border-[#332F2B] text-[11px]">
                      <Fingerprint className="w-3 h-3 text-[#8B7E74] dark:text-[#A39E93] shrink-0" />
                      <span
                        className="font-mono text-[10px] text-[#5A534B] dark:text-[#D4CEC7] max-w-[85px] sm:max-w-[120px] truncate"
                        title={member.uid}
                      >
                        {member.uid}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(member.uid)}
                        title="Copy Firebase UID"
                        className="p-0.5 hover:text-[#D4A373] text-[#8B7E74] dark:text-[#A39E93] transition cursor-pointer"
                      >
                        {copiedUid === member.uid ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {/* Added Date */}
                    <div className="hidden lg:flex items-center gap-1 text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(member.addedAt)}</span>
                    </div>

                    {/* Owner Management Action Controls */}
                    {isOwner && (
                      <div className="flex items-center gap-1 ml-auto md:ml-0">
                        {isMemberOwner ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-[#8B7E74] dark:text-[#A39E93] px-2 py-1"
                            title="Workspace Owner account is protected and cannot be altered or removed"
                          >
                            <Lock className="w-3 h-3" />
                            <span className="text-[10px]">Protected</span>
                          </span>
                        ) : (
                          <>
                            {/* Quick Active/Inactive Toggle */}
                            <button
                              type="button"
                              onClick={() => handleQuickToggleActive(member)}
                              title={member.active ? 'Deactivate member' : 'Activate member'}
                              className={`px-2 py-1 text-[10px] font-semibold rounded border transition cursor-pointer ${
                                member.active
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900/40'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40'
                              }`}
                            >
                              {member.active ? 'Deactivate' : 'Activate'}
                            </button>

                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(member)}
                              title="Edit member role & display name"
                              className="p-1.5 rounded-lg hover:bg-[#F0ECE4] dark:hover:bg-[#2D2925] text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] transition cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Remove Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenRemove(member)}
                              title="Remove member from workspace"
                              className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =========================================================================
          ADD MEMBER MODAL (Owner Only)
      ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-[#1E1B18] rounded-2xl shadow-2xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#EEECE8] dark:border-[#2D2925]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-[#D4A373]">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    Add Workspace Member
                  </h4>
                  <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                    Scoped to workspace <code className="font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">{activeWorkspaceId}</code>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseAdd}
                className="p-1 rounded-lg text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleAddSubmit} className="p-5 space-y-4">
              {addError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{addError}</span>
                </div>
              )}

              {/* Firebase UID */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                  Firebase UID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={addUid}
                  onChange={(e) => setAddUid(e.target.value)}
                  placeholder="e.g. 4vK9sXyZ... (paste full Firebase UID)"
                  className="w-full px-3.5 py-2 text-xs font-mono bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
                <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] mt-1">
                  Ask the user to copy their full Firebase UID from the "Account Not Authorized" screen.
                </p>
              </div>

              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                  Google Account Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="e.g. sunnysweetsapopka@gmail.com"
                  className="w-full px-3.5 py-2 text-xs bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                  Display Name <span className="text-[10px] font-normal text-[#8B7E74]">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Sunny Sweets Baker"
                  className="w-full px-3.5 py-2 text-xs bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-2">
                  Access Role <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                      addRole === 'editor'
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-[#EEECE8] dark:border-[#332F2B] hover:bg-[#FAF8F5] dark:hover:bg-[#25221F]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value="editor"
                      checked={addRole === 'editor'}
                      onChange={() => setAddRole('editor')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                        <Edit3 className="w-3 h-3 text-blue-600" />
                        <span>Editor</span>
                      </div>
                      <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                        Can create, edit, scale, and save recipes & production batches.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                      addRole === 'viewer'
                        ? 'border-slate-500 bg-slate-50/50 dark:bg-slate-900/30'
                        : 'border-[#EEECE8] dark:border-[#332F2B] hover:bg-[#FAF8F5] dark:hover:bg-[#25221F]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value="viewer"
                      checked={addRole === 'viewer'}
                      onChange={() => setAddRole('viewer')}
                      className="mt-0.5 text-slate-600 focus:ring-slate-500"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                        <Eye className="w-3 h-3 text-slate-600" />
                        <span>Viewer</span>
                      </div>
                      <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                        Read-only access to view recipes, batch math, and print production sheets.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EEECE8] dark:border-[#2D2925]">
                <button
                  type="button"
                  onClick={handleCloseAdd}
                  disabled={isSubmittingAdd}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingAdd ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating Membership...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Member</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          EDIT MEMBER MODAL (Owner Only)
      ========================================================================= */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-[#1E1B18] rounded-2xl shadow-2xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#EEECE8] dark:border-[#2D2925]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    Edit Member Access
                  </h4>
                  <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                    {editingMember.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseEdit}
                className="p-1 rounded-lg text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {editError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{editError}</span>
                </div>
              )}

              {/* Display Name */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Display Name"
                  className="w-full px-3.5 py-2 text-xs bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] mb-2">
                  Access Role
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                      editRole === 'editor'
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-[#EEECE8] dark:border-[#332F2B] hover:bg-[#FAF8F5] dark:hover:bg-[#25221F]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="editRole"
                      value="editor"
                      checked={editRole === 'editor'}
                      onChange={() => setEditRole('editor')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                        <Edit3 className="w-3 h-3 text-blue-600" />
                        <span>Editor</span>
                      </div>
                      <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                        Can edit recipes, mixers, presets, and calculate batches.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                      editRole === 'viewer'
                        ? 'border-slate-500 bg-slate-50/50 dark:bg-slate-900/30'
                        : 'border-[#EEECE8] dark:border-[#332F2B] hover:bg-[#FAF8F5] dark:hover:bg-[#25221F]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="editRole"
                      value="viewer"
                      checked={editRole === 'viewer'}
                      onChange={() => setEditRole('viewer')}
                      className="mt-0.5 text-slate-600 focus:ring-slate-500"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                        <Eye className="w-3 h-3 text-slate-600" />
                        <span>Viewer</span>
                      </div>
                      <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                        Read-only access to view recipes and calculate batches.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Status Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B]">
                <div>
                  <div className="text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                    Account Active Status
                  </div>
                  <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                    {editActive
                      ? 'Member can log in and access workspace data.'
                      : 'Member is suspended and cannot access workspace data.'}
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D4A373]"></div>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EEECE8] dark:border-[#2D2925]">
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          REMOVE MEMBER CONFIRMATION MODAL (Owner Only)
      ========================================================================= */}
      {memberToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-[#1E1B18] rounded-2xl shadow-2xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    Remove Workspace Member?
                  </h4>
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                    This action will immediately revoke their workspace access.
                  </p>
                </div>
              </div>

              {removeError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-xs text-red-700 dark:text-red-300">
                  {removeError}
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#8B7E74] dark:text-[#A39E93]">Member Name:</span>
                  <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">{memberToRemove.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B7E74] dark:text-[#A39E93]">Email Address:</span>
                  <span className="font-mono text-[11px] text-[#5A534B] dark:text-[#EAE6E1]">{memberToRemove.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B7E74] dark:text-[#A39E93]">Firebase UID:</span>
                  <span className="font-mono text-[10px] text-[#5A534B] dark:text-[#EAE6E1] truncate max-w-[180px]">{memberToRemove.uid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B7E74] dark:text-[#A39E93]">Role:</span>
                  <span className="capitalize font-semibold text-[#5A534B] dark:text-[#EAE6E1]">{memberToRemove.role}</span>
                </div>
              </div>

              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                The member document in <code className="font-mono text-[11px]">workspaces/{activeWorkspaceId}/members/{memberToRemove.uid}</code> will be deleted. Upon their next validation or page reload, their session will revert to unauthorized.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseRemove}
                  disabled={isSubmittingRemove}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRemove}
                  disabled={isSubmittingRemove}
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingRemove ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Remove</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
