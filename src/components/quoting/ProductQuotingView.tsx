import React, { useState, useEffect, useCallback } from 'react';
import { ProductProject, FormulaOwnership } from '../../types/quoting';
import { Workspace, MasterIngredient, AccessRole } from '../../types';
import { quotingService, canUserAccessQuoting } from '../../services/quotingService';
import { store } from '../../services/store';
import { auth } from '../../services/firebase';
import { ProductQuotingDashboard } from './ProductQuotingDashboard';
import { ProjectEditor } from './ProjectEditor';
import { ShieldAlert, Lock, AlertTriangle } from 'lucide-react';
import { parseRoute, navigateToRoute } from '../../utils/navigation';

interface ProductQuotingViewProps {
  onNotification?: (msg: string) => void;
  onOpenRecipe?: (recipeId: string) => void;
}

export const ProductQuotingView: React.FC<ProductQuotingViewProps> = ({ onNotification, onOpenRecipe }) => {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => store.getActiveWorkspace());
  const [userRole, setUserRole] = useState<AccessRole>(() => store.getUserRole());
  const [masterIngredients, setMasterIngredients] = useState<MasterIngredient[]>(() =>
    store.getMasterIngredients()
  );
  const [recipes, setRecipes] = useState(() => store.getRecipes());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => parseRoute().projectId || null);
  const [editorTab, setEditorTab] = useState<'formula' | 'products' | 'history'>(() => parseRoute().editorTab || 'formula');
  const [projects, setProjects] = useState<ProductProject[]>(() => {
    const wsId = store.getActiveWorkspaceId();
    return wsId ? quotingService.getProjects(wsId) : [];
  });

  const activeWsId = workspace?.id || store.getActiveWorkspaceId();

  // Synchronize route on browser Back / Forward (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const route = parseRoute();
      if (route.tab === 'quotes') {
        setActiveProjectId(route.projectId || null);
        setEditorTab(route.editorTab || 'formula');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Subscribe to store and quoting service
  useEffect(() => {
    const unsubStore = store.subscribe(() => {
      setWorkspace(store.getActiveWorkspace());
      setUserRole(store.getUserRole());
      setMasterIngredients(store.getMasterIngredients());
      setRecipes(store.getRecipes());
    });

    const unsubQuoting = quotingService.subscribe(() => {
      if (activeWsId) {
        setProjects(quotingService.getProjects(activeWsId));
      }
    });

    if (activeWsId) {
      quotingService.initWorkspaceSync(activeWsId);
      setProjects(quotingService.getProjects(activeWsId));
    }

    return () => {
      unsubStore();
      unsubQuoting();
    };
  }, [activeWsId]);

  const handleSaveDraft = useCallback(
    async (updated: ProductProject) => {
      const saved = await quotingService.saveProject(updated);
      onNotification?.('Project draft saved.');
      return saved;
    },
    [onNotification]
  );

  // Access Control Check
  const hasAccess = canUserAccessQuoting(workspace, userRole, false);

  if (!hasAccess) {
    return (
      <div className="max-w-2xl mx-auto p-6 sm:p-12 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto shadow-xs">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="font-serif font-bold text-xl text-stone-900 dark:text-zinc-100">
          Management Access Restricted
        </h2>
        <p className="text-xs sm:text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
          Product Development & Quoting contains proprietary formulas, ingredient purchasing costs, and commercial pricing models. Access is limited to authorized workspace Managers and Owners with the quoting capability enabled.
        </p>
      </div>
    );
  }

  // Active Project Detail Editor
  if (activeProjectId) {
    const currentProject =
      projects.find((p) => p.id === activeProjectId) ||
      (activeWsId ? quotingService.getProject(activeWsId, activeProjectId) : undefined);

    if (!currentProject) {
      return (
        <div className="p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
          <h3 className="font-bold text-base text-stone-900 dark:text-zinc-100">
            Project Not Found
          </h3>
          <button
            onClick={() => {
              setActiveProjectId(null);
              navigateToRoute('quotes', null);
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-amber-600 rounded-xl cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      );
    }

    return (
      <ProjectEditor
        key={currentProject.id}
        project={currentProject}
        masterIngredients={masterIngredients}
        initialTab={editorTab}
        onTabChange={(tab) => {
          setEditorTab(tab);
          navigateToRoute('quotes', currentProject.id, tab);
        }}
        onBack={() => {
          setActiveProjectId(null);
          navigateToRoute('quotes', null);
        }}
        onOpenRecipe={onOpenRecipe}
        onSaveDraft={handleSaveDraft}
        onUpdateMetadata={async (projectId, metadata) => {
          if (activeWsId) {
            await quotingService.updateProjectMetadata(activeWsId, projectId, metadata);
            onNotification?.('Project details updated.');
          }
        }}
        onIssueRevision={async (projectId, notes, draft) => {
          const userUid = auth.currentUser?.uid || 'user-mgmt';
          const userName = auth.currentUser?.displayName || auth.currentUser?.email || 'Manager';
          if (activeWsId) {
            await quotingService.issueQuoteRevision(projectId, activeWsId, userUid, userName, notes, draft, userRole);
            onNotification?.('Quote revision issued and frozen.');
          }
        }}
        onDuplicate={async (projectId) => {
          const userUid = auth.currentUser?.uid || 'user-mgmt';
          if (activeWsId) {
            const duplicated = await quotingService.duplicateProject(projectId, activeWsId, userUid);
            setActiveProjectId(duplicated.id);
            navigateToRoute('quotes', duplicated.id, 'formula');
            onNotification?.('Project duplicated.');
          }
        }}
        onArchive={async (projectId) => {
          const userUid = auth.currentUser?.uid || 'user-mgmt';
          if (activeWsId) {
            await quotingService.archiveProject(projectId, activeWsId, userUid);
            setActiveProjectId(null);
            navigateToRoute('quotes', null);
            onNotification?.('Project archived.');
          }
        }}
        onUnarchive={async (projectId) => {
          const userUid = auth.currentUser?.uid || 'user-mgmt';
          if (activeWsId) {
            await quotingService.unarchiveProject(projectId, activeWsId, userUid);
            onNotification?.('Project unarchived.');
          }
        }}
      />
    );
  }

  // Dashboard List View
  return (
    <ProductQuotingDashboard
      projects={projects}
      workspace={workspace}
      recipes={recipes}
      onOpenProject={(id) => {
        setActiveProjectId(id);
        navigateToRoute('quotes', id, 'formula');
      }}
      onCreateProject={async (params) => {
        const userUid = auth.currentUser?.uid || 'user-mgmt';
        if (!activeWsId) {
          throw new Error('No active workspace selected. Please select a workspace first.');
        }
        const created = await quotingService.createProject({
          ...params,
          workspaceId: activeWsId,
          userId: userUid,
        });
        setProjects((prev) => {
          const exists = prev.some((p) => p.id === created.id);
          return exists ? prev : [created, ...prev];
        });
        setActiveProjectId(created.id);
        navigateToRoute('quotes', created.id, 'formula');
        onNotification?.(`Created project "${created.productName}"`);
        return created;
      }}
      onDuplicateProject={async (id) => {
        const userUid = auth.currentUser?.uid || 'user-mgmt';
        if (activeWsId) {
          await quotingService.duplicateProject(id, activeWsId, userUid);
          onNotification?.('Project duplicated.');
        }
      }}
      onArchiveProject={async (id) => {
        const userUid = auth.currentUser?.uid || 'user-mgmt';
        if (activeWsId) {
          await quotingService.archiveProject(id, activeWsId, userUid);
          onNotification?.('Project archived.');
        }
      }}
      onUnarchiveProject={async (id) => {
        const userUid = auth.currentUser?.uid || 'user-mgmt';
        if (activeWsId) {
          await quotingService.unarchiveProject(id, activeWsId, userUid);
          onNotification?.('Project unarchived.');
        }
      }}
      onUpdateMetadata={async (projectId, metadata) => {
        if (activeWsId) {
          await quotingService.updateProjectMetadata(activeWsId, projectId, metadata);
          onNotification?.('Project details updated.');
        }
      }}
    />
  );
};
