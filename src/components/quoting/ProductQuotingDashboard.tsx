import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus,
  Search,
  FileText,
  Package,
  Layers,
  Calendar,
  Building,
  Archive,
  Copy,
  ArrowRight,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  Lock,
  Database,
  Pencil,
  AlertTriangle,
  X,
  Trash2,
} from 'lucide-react';
import { ProductProject, ProjectStatus, FormulaOwnership, QuoteFormula } from '../../types/quoting';
import { MasterIngredient, Workspace, Recipe } from '../../types';
import { convertRecipeToQuoteFormula } from '../../utils/quotingCalculator';
import { store } from '../../services/store';
import { auth } from '../../services/firebase';
import { RecoveryInspectionModal } from './RecoveryInspectionModal';
import { ProjectDeletionModal } from './ProjectDeletionModal';

interface ProductQuotingDashboardProps {
  projects: ProductProject[];
  workspace: Workspace | null;
  recipes?: Recipe[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: (params: {
    productName: string;
    customerName?: string;
    productCategory?: string;
    formulaOwnership?: FormulaOwnership;
    description?: string;
    sourceRecipeId?: string;
    sourceRecipeName?: string;
    initialFormula?: QuoteFormula;
  }) => Promise<ProductProject | void>;
  onDuplicateProject: (projectId: string) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onUnarchiveProject: (projectId: string) => Promise<void>;
  onUpdateMetadata?: (projectId: string, metadata: {
    productName?: string;
    customerName?: string;
    description?: string;
    status?: ProjectStatus;
    productCategory?: string;
    formulaOwnership?: FormulaOwnership;
  }) => Promise<void>;
}

export const ProductQuotingDashboard: React.FC<ProductQuotingDashboardProps> = ({
  projects,
  workspace,
  recipes,
  onOpenProject,
  onCreateProject,
  onDuplicateProject,
  onArchiveProject,
  onUnarchiveProject,
  onUpdateMetadata,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'quoted' | 'approved' | 'archived'>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<'blank' | 'recipe'>('blank');
  const [recipeSearchTerm, setRecipeSearchTerm] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const isSubmittingRef = useRef(false);

  const [newProductName, setNewProductName] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCategory, setNewCategory] = useState('Cookie');
  const [newOwnership, setNewOwnership] = useState<FormulaOwnership>('bakery_owned');
  const [newDescription, setNewDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProductProject | null>(null);

  // Filter recipes authorized for the active workspace
  const availableRecipes = useMemo(() => {
    const list = recipes && recipes.length > 0 ? recipes : store.getRecipes();
    const wsId = workspace?.id || store.getActiveWorkspaceId();
    return list.filter((r) => {
      if (r.archived) return false;
      if (wsId && r.workspaceId && r.workspaceId !== wsId) return false;
      return true;
    });
  }, [recipes, workspace?.id]);

  const filteredMatchingRecipes = useMemo(() => {
    if (!recipeSearchTerm.trim()) {
      return availableRecipes.slice(0, 10);
    }
    const term = recipeSearchTerm.toLowerCase();
    return availableRecipes
      .filter((r) => r.name.toLowerCase().includes(term) || (r.category || '').toLowerCase().includes(term))
      .slice(0, 15);
  }, [availableRecipes, recipeSearchTerm]);

  const handleSelectRecipe = (r: Recipe) => {
    setSelectedRecipe(r);
    setNewProductName(r.name);
    if (r.category) {
      setNewCategory(r.category);
    }
    if (r.description) {
      setNewDescription(r.description);
    }
    setCreateError(null);
  };

  const handleClearSelectedRecipe = () => {
    setSelectedRecipe(null);
    setRecipeSearchTerm('');
    setNewProductName('');
    setNewDescription('');
    setCreateError(null);
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreationMode('blank');
    setSelectedRecipe(null);
    setRecipeSearchTerm('');
    setNewProductName('');
    setNewCustomerName('');
    setNewDescription('');
    setCreateError(null);
  };

  // Rename & Details Modal
  const [editingProject, setEditingProject] = useState<ProductProject | null>(null);
  const [editName, setEditName] = useState('');
  const [editCustomer, setEditCustomer] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<ProjectStatus>('draft');
  const [editCategory, setEditCategory] = useState('Cookie');
  const [editOwnership, setEditOwnership] = useState<FormulaOwnership>('bakery_owned');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Filtered project list
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      // Status filter
      if (statusFilter === 'archived') {
        if (!p.archived && p.status !== 'archived') return false;
      } else {
        if (p.archived || p.status === 'archived') return false;
        if (statusFilter === 'draft' && p.status !== 'draft' && p.status !== 'testing') return false;
        if (statusFilter === 'quoted' && p.status !== 'quoted' && p.status !== 'ready_to_quote') return false;
        if (statusFilter === 'approved' && p.status !== 'approved') return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchesName = p.productName.toLowerCase().includes(term);
        const matchesCust = (p.customerName || '').toLowerCase().includes(term);
        const matchesCode = (p.projectCode || '').toLowerCase().includes(term);
        const matchesDesc = (p.description || '').toLowerCase().includes(term);
        if (!matchesName && !matchesCust && !matchesCode && !matchesDesc) return false;
      }

      return true;
    });
  }, [projects, statusFilter, searchTerm]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;

    if (!newProductName.trim()) {
      setCreateError('Please provide a project name.');
      return;
    }

    if (creationMode === 'recipe' && !selectedRecipe) {
      setCreateError('Please select a production recipe to import, or switch to Blank Formula.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setCreateError(null);

    try {
      let initialFormula: QuoteFormula | undefined = undefined;
      let sourceRecipeId: string | undefined = undefined;
      let sourceRecipeName: string | undefined = undefined;

      if (creationMode === 'recipe' && selectedRecipe) {
        // Deep copy snapshot conversion with recalculated live costs from pantry
        const masterIngredients = store.getMasterIngredients();
        initialFormula = convertRecipeToQuoteFormula(selectedRecipe, masterIngredients);
        sourceRecipeId = selectedRecipe.id;
        sourceRecipeName = selectedRecipe.name;
      }

      const created = await onCreateProject({
        productName: newProductName.trim(),
        customerName: newCustomerName.trim() || undefined,
        productCategory: newCategory,
        formulaOwnership: newOwnership,
        description: newDescription.trim() || undefined,
        sourceRecipeId,
        sourceRecipeName,
        initialFormula,
      });

      handleCloseCreateModal();
      if (created && created.id) {
        onOpenProject(created.id);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create project. Please verify inputs and permissions.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: ProjectStatus, archived?: boolean) => {
    if (archived || status === 'archived') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400">
          Archived
        </span>
      );
    }
    switch (status) {
      case 'draft':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300">
            Draft
          </span>
        );
      case 'testing':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
            Testing / R&D
          </span>
        );
      case 'ready_to_quote':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
            Ready to Quote
          </span>
        );
      case 'quoted':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
            Quoted
          </span>
        );
      case 'approved':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            Approved
          </span>
        );
      case 'declined':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300">
            Declined
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif font-bold text-xl sm:text-2xl text-stone-900 dark:text-zinc-100">
              Product Development & Quotes
            </h2>
            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Management Only
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Formulate working recipes, evaluate multi-size case scenarios, calculate commercial margins, and preserve historical quotes.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="btn-open-recovery-inspection"
            onClick={() => setIsRecoveryModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-stone-700 dark:text-zinc-300 border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 hover:bg-stone-100 dark:hover:bg-zinc-750 transition-colors shrink-0 cursor-pointer"
            title="Inspect candidate recovery records from local storage and cache"
          >
            <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Data Recovery</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setIsCreateModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Project</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            type="text"
            placeholder="Search by product, customer, or quote code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto p-1 rounded-xl bg-stone-100 dark:bg-zinc-800/80 border border-stone-200 dark:border-zinc-700 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 shadow-2xs'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900'
            }`}
          >
            All Active ({projects.filter((p) => !p.archived && p.status !== 'archived').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('draft')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
              statusFilter === 'draft'
                ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 shadow-2xs'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900'
            }`}
          >
            Drafts
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('quoted')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
              statusFilter === 'quoted'
                ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 shadow-2xs'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900'
            }`}
          >
            Quoted
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('approved')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
              statusFilter === 'approved'
                ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 shadow-2xs'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900'
            }`}
          >
            Approved
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
              statusFilter === 'archived'
                ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 shadow-2xs'
                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900'
            }`}
          >
            Archived ({projects.filter((p) => p.archived || p.status === 'archived').length})
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-xs space-y-3">
          <FileText className="w-12 h-12 text-stone-300 dark:text-zinc-600 mx-auto" />
          <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
            {searchTerm ? 'No Matching Projects Found' : 'No Development Projects'}
          </h3>
          <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
            {searchTerm
              ? `No projects matched "${searchTerm}". Try adjusting your search query.`
              : 'Create your first product development or quoting project to formulate recipes and evaluate packaging scenarios.'}
          </p>
          {!searchTerm && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Create First Project</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => {
            const formulaLinesCount = p.formula?.lines?.length || 0;
            const formulaCost = p.formula?.totalCost || 0;
            const productsCount = p.products?.length || 0;
            const updatedDate = new Date(p.updatedAt || p.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });

            // Calculate quoted price range if products exist
            let priceRangeStr = 'No pricing configured';
            if (productsCount > 0) {
              const prices = p.products.map((prod) => prod.quotedPrice).filter((pr) => pr > 0);
              if (prices.length > 0) {
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                priceRangeStr =
                  minPrice === maxPrice
                    ? `$${minPrice.toFixed(2)} / ${p.products[0].unitName || 'case'}`
                    : `$${minPrice.toFixed(2)} – $${maxPrice.toFixed(2)} / case`;
              }
            }

            return (
              <div
                key={p.id}
                className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
              >
                <div className="p-4 sm:p-5 space-y-3">
                  {/* Top line: Code & Status */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
                      {p.projectCode || 'PROJECT'}
                    </span>
                    {getStatusBadge(p.status, p.archived)}
                  </div>

                  {/* Product & Customer Titles */}
                  <div>
                    <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100 line-clamp-1">
                      {p.productName}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
                      {p.customerName ? `Customer: ${p.customerName}` : 'Internal Bakery R&D'}
                    </p>
                  </div>

                  {/* Metrics Strip */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100 dark:border-zinc-800 text-xs">
                    <div>
                      <span className="text-[10px] text-stone-400 block uppercase font-semibold">Formula</span>
                      <span className="font-mono font-bold text-stone-800 dark:text-zinc-200">
                        {formulaLinesCount > 0 ? `${formulaLinesCount} ings • $${formulaCost.toFixed(2)}` : 'Empty formula'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-stone-400 block uppercase font-semibold">Pricing</span>
                      <span className="font-mono font-bold text-stone-800 dark:text-zinc-200">
                        {productsCount > 0 ? `${productsCount} ${productsCount === 1 ? 'size' : 'sizes'}` : '0 sizes'}
                      </span>
                    </div>
                  </div>

                  {/* Quoted Price Summary */}
                  <div className="p-2.5 rounded-xl bg-stone-50 dark:bg-zinc-800/60 border border-stone-100 dark:border-zinc-800 text-xs flex items-center justify-between">
                    <span className="text-[11px] text-stone-500 dark:text-zinc-400">Quoted Range:</span>
                    <span className="font-mono font-bold text-amber-800 dark:text-amber-300">
                      {priceRangeStr}
                    </span>
                  </div>
                </div>

                {/* Bottom Footer Actions */}
                <div className="px-4 py-3 border-t border-stone-100 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/30 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-stone-400 dark:text-zinc-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{updatedDate}</span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`btn-edit-metadata-${p.id}`}
                      onClick={() => {
                        setEditingProject(p);
                        setEditName(p.productName);
                        setEditCustomer(p.customerName || '');
                        setEditDescription(p.description || '');
                        setEditStatus(p.status);
                        setEditCategory(p.productCategory || 'Cookie');
                        setEditOwnership(p.formulaOwnership || 'bakery_owned');
                      }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                      title="Edit Details / Rename Project"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDuplicateProject(p.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                      title="Duplicate Project"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {p.archived ? (
                      <button
                        type="button"
                        onClick={() => onUnarchiveProject(p.id)}
                        className="px-2.5 py-1 text-xs font-bold text-stone-600 dark:text-zinc-300 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onArchiveProject(p.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                        title="Archive Project"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid={`btn-delete-project-${p.id}`}
                      onClick={() => setDeletingProject(p)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                      title="Delete Project Permanently"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      className="px-3 py-1 rounded-lg font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create New Project */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 pb-4 border-b border-stone-100 dark:border-zinc-800 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold shrink-0">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                    New Product Development Project
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Start a fresh formula or import an independent copy of an existing recipe.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCreateModal}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Option Selector: Blank Formula vs Use Existing Recipe */}
              <div className="grid grid-cols-2 p-1 bg-stone-100 dark:bg-zinc-800 rounded-xl" role="tablist">
                <button
                  type="button"
                  data-testid="create-opt-blank"
                  onClick={() => {
                    setCreationMode('blank');
                    setSelectedRecipe(null);
                    setCreateError(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    creationMode === 'blank'
                      ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-xs'
                      : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Start Blank</span>
                </button>
                <button
                  type="button"
                  data-testid="create-opt-recipe"
                  onClick={() => {
                    setCreationMode('recipe');
                    setCreateError(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    creationMode === 'recipe'
                      ? 'bg-white dark:bg-zinc-900 text-amber-700 dark:text-amber-400 shadow-xs'
                      : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Use Existing Recipe</span>
                </button>
              </div>

              {createError && (
                <div
                  data-testid="create-project-error"
                  className="p-3 text-xs font-semibold rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 flex items-center gap-2 animate-in fade-in"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              {/* Recipe Selection Section (When in 'recipe' mode) */}
              {creationMode === 'recipe' && (
                <div className="space-y-3 pt-1">
                  {!selectedRecipe ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300">
                          Search & Select Production Recipe *
                        </label>
                        <span className="text-[11px] text-stone-400 dark:text-zinc-500">
                          {availableRecipes.length} available
                        </span>
                      </div>
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
                        <input
                          type="text"
                          data-testid="search-existing-recipes-input"
                          placeholder="Search recipes by name or category..."
                          value={recipeSearchTerm}
                          onChange={(e) => setRecipeSearchTerm(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                        />
                      </div>

                      <div
                        data-testid="recipes-selection-list"
                        className="max-h-48 overflow-y-auto rounded-xl border border-stone-200 dark:border-zinc-700 divide-y divide-stone-100 dark:divide-zinc-800 bg-stone-50/50 dark:bg-zinc-800/40"
                      >
                        {filteredMatchingRecipes.length === 0 ? (
                          <div className="p-4 text-center text-xs text-stone-400 dark:text-zinc-500">
                            {availableRecipes.length === 0
                              ? 'No production recipes found in this workspace.'
                              : `No recipes found matching "${recipeSearchTerm}".`}
                          </div>
                        ) : (
                          filteredMatchingRecipes.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              data-testid={`recipe-item-${r.id}`}
                              onClick={() => handleSelectRecipe(r)}
                              className="w-full text-left p-2.5 sm:p-3 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100 group-hover:text-amber-800 dark:group-hover:text-amber-300">
                                    {r.name}
                                  </span>
                                  {r.category && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-stone-200/70 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300">
                                      {r.category}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-stone-500 dark:text-zinc-400 block mt-0.5">
                                  {r.ingredients?.length || 0} ingredients • Yield: {r.batchYieldQuantity} {r.batchYieldUnit}
                                </span>
                              </div>
                              <span className="text-xs font-bold text-amber-700 dark:text-amber-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                Select →
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      data-testid="selected-recipe-confirmation"
                      className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-3 animate-in fade-in"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          ✓
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-amber-800 dark:text-amber-300 block">
                            Source Recipe Selected
                          </span>
                          <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100 truncate block">
                            {selectedRecipe.name}
                          </span>
                          <span className="text-[10px] text-stone-500 dark:text-zinc-400 block truncate">
                            {selectedRecipe.ingredients.length} ingredients • Yield: {selectedRecipe.batchYieldQuantity} {selectedRecipe.batchYieldUnit}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="btn-change-selected-recipe"
                        onClick={handleClearSelectedRecipe}
                        className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:text-amber-900 hover:underline px-2 py-1 shrink-0 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Project Metadata Form */}
              <form id="new-project-form" onSubmit={handleCreateSubmit} className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Product / Project Name *
                  </label>
                  <input
                    type="text"
                    required
                    data-testid="new-project-name-input"
                    placeholder="e.g. Pepe's Chocolate Chip Cookie, Brioche Bun"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Customer / Company (Optional)
                  </label>
                  <input
                    type="text"
                    data-testid="new-customer-name-input"
                    placeholder="e.g. Pepe's Cantina, In-house R&D"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Category
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="Cookie">Cookie</option>
                      <option value="Dough">Dough</option>
                      <option value="Pie Dough">Pie Dough</option>
                      <option value="Bread">Bread</option>
                      <option value="Muffin">Muffin</option>
                      <option value="Brownie">Brownie</option>
                      <option value="Bar">Bar</option>
                      <option value="Scone">Scone</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Formula Ownership
                    </label>
                    <select
                      value={newOwnership}
                      onChange={(e) => setNewOwnership(e.target.value as FormulaOwnership)}
                      className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="bakery_owned">Bakery-Owned</option>
                      <option value="customer_owned">Customer-Owned</option>
                      <option value="joint_development">Joint R&D</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Description / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Target launch date, client requirements, specifications..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </form>
            </div>

            {/* Modal Footer */}
            <div className="p-4 px-5 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-end gap-3 shrink-0 bg-stone-50/50 dark:bg-zinc-850/50">
              <button
                type="button"
                data-testid="btn-cancel-create-project"
                onClick={handleCloseCreateModal}
                className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="new-project-form"
                data-testid="btn-submit-create-project"
                disabled={isSubmitting || !newProductName.trim() || (creationMode === 'recipe' && !selectedRecipe)}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? 'Creating Project...'
                  : creationMode === 'recipe'
                  ? 'Create Project from Recipe'
                  : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Edit Project Details & Metadata (Rename without touching formulas) */}
      {editingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold">
                <Pencil className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                  Edit Project Details & Metadata
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Rename project or update details without altering formulas or ingredients.
                </p>
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editName.trim() || !editingProject) return;
                setIsSavingEdit(true);
                try {
                  await onUpdateMetadata?.(editingProject.id, {
                    productName: editName.trim(),
                    customerName: editCustomer.trim(),
                    description: editDescription.trim(),
                    status: editStatus,
                    productCategory: editCategory,
                    formulaOwnership: editOwnership,
                  });
                  setEditingProject(null);
                } finally {
                  setIsSavingEdit(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                  Product / Project Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                  Customer / Company
                </label>
                <input
                  type="text"
                  value={editCustomer}
                  onChange={(e) => setEditCustomer(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500 capitalize"
                  >
                    <option value="draft">Draft</option>
                    <option value="testing">Testing</option>
                    <option value="ready_to_quote">Ready to Quote</option>
                    <option value="quoted">Quoted</option>
                    <option value="approved">Approved</option>
                    <option value="declined">Declined</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="Cookie">Cookie</option>
                    <option value="Dough">Dough</option>
                    <option value="Pie Dough">Pie Dough</option>
                    <option value="Bread">Bread</option>
                    <option value="Muffin">Muffin</option>
                    <option value="Brownie">Brownie</option>
                    <option value="Bar">Bar</option>
                    <option value="Scone">Scone</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                  Description / Notes
                </label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Data Recovery Inspection (Phase 2B.5.6.3A) */}
      <RecoveryInspectionModal
        workspaceId={workspace?.id || ''}
        isOpen={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
      />

      {/* Modal: Project Deletion (Phase 2B.5.10) */}
      <ProjectDeletionModal
        isOpen={!!deletingProject}
        project={deletingProject}
        workspaceId={workspace?.id || store.getActiveWorkspaceId() || 'ws-main'}
        userRole={store.getUserRole()}
        userId={auth.currentUser?.uid || 'user-mgmt'}
        onClose={() => setDeletingProject(null)}
        onSuccess={(deletedId, msg) => {
          setDeletingProject(null);
        }}
        onArchiveInstead={(id) => {
          setDeletingProject(null);
          onArchiveProject(id);
        }}
      />
    </div>
  );
};
