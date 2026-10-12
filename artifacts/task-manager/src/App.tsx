import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetCurrentAccessQueryKey,
  getGetTaskSummaryQueryKey,
  getListTasksQueryKey,
  useCreateTask,
  useDeleteTask,
  useGetCurrentAccess,
  useGetTaskSummary,
  useListTasks,
  useUpdateTask,
} from '@workspace/api-client-react';
import type { Task, TaskPriority, TaskStatus } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, Check, CheckCheck, ChevronDown, Circle, Clock3, Eye, ListFilter, LoaderCircle, LockKeyhole, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { Form } from '@/components/ui/form';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2d6959',
    colorForeground: '#233b35',
    colorMutedForeground: '#66736d',
    colorDanger: '#a83d38',
    colorBackground: '#fffdf8',
    colorInput: '#f8f5ed',
    colorInputForeground: '#233b35',
    colorNeutral: '#d9d5ca',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#233b35] font-bold tracking-tight',
    headerSubtitle: 'text-[#66736d]',
    socialButtonsBlockButtonText: 'text-[#233b35] font-semibold',
    formFieldLabel: 'text-[#233b35] font-semibold',
    footerActionLink: 'text-[#2d6959] font-semibold',
    footerActionText: 'text-[#66736d]',
    dividerText: 'text-[#66736d]',
    identityPreviewEditButton: 'text-[#2d6959]',
    formFieldSuccessText: 'text-[#2d6959]',
    alertText: 'text-[#7d332f]',
    logoBox: 'mb-2',
    logoImage: 'rounded-xl',
    socialButtonsBlockButton: 'border-[#d9d5ca] bg-[#fffdf8] hover:bg-[#f4f0e7]',
    formButtonPrimary: 'bg-[#2d6959] hover:bg-[#25574a] text-white shadow-none',
    formFieldInput: 'bg-[#f8f5ed] border-[#d9d5ca] text-[#233b35]',
    footerAction: 'border-t border-[#e4dfd4]',
    dividerLine: 'bg-[#d9d5ca]',
    alert: 'bg-[#fbefeb] border-[#e9c5bd]',
    otpCodeFieldInput: 'border-[#d9d5ca] bg-[#f8f5ed]',
    formFieldRow: 'gap-1.5',
    main: 'gap-5',
  },
};

type Filters = { search?: string; status?: TaskStatus; priority?: TaskPriority };
type TaskDraft = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
};

const EMPTY_DRAFT: TaskDraft = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: '',
};

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const previousUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUser.current !== undefined && previousUser.current !== userId) cache.clear();
      previousUser.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);
  return null;
}

function SignInPage() {
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const ownerConfigured = accessQuery.data?.ownerConfigured === true;
  return (
    <AuthFrame>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={ownerConfigured ? `${basePath}/sign-up` : undefined}
        appearance={{
          ...clerkAppearance,
          elements: { ...clerkAppearance.elements, footerAction: ownerConfigured ? clerkAppearance.elements.footerAction : 'hidden' },
        }}
      />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-frame">
      <Link href="/" className="auth-back" data-testid="link-back-home"><ArrowUpRight size={16} /> Về danh sách việc</Link>
      {children}
    </main>
  );
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Chào mừng trở lại', subtitle: 'Đăng nhập để quản lý danh sách chung.' } },
        signUp: { start: { title: 'Tạo tài khoản chủ sở hữu', subtitle: 'Bắt đầu sắp xếp công việc cùng nhau.' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <Switch>
          <Route path="/" component={TaskHome} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkRoutes />
    </WouterRouter>
  );
}

function TaskHome() {
  const [filters, setFilters] = useState<Filters>({});
  const [dialogTask, setDialogTask] = useState<Task | null | 'new'>(null);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');
  const cache = useQueryClient();
  const stableFilters = useMemo(() => {
    const next: Filters = {};
    const search = filters.search?.trim();
    if (search) next.search = search;
    if (filters.status) next.status = filters.status;
    if (filters.priority) next.priority = filters.priority;
    return next;
  }, [filters.search, filters.status, filters.priority]);
  const tasksQuery = useListTasks(stableFilters, { query: { queryKey: getListTasksQueryKey(stableFilters) } });
  const summaryQuery = useGetTaskSummary({ query: { queryKey: getGetTaskSummaryQueryKey() } });
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const access = accessQuery.data;
  const isOwner = access?.isOwner === true;
  const isAccessDenied = statusCode(accessQuery.error) === 401 || statusCode(accessQuery.error) === 403;
  const tasks = tasksQuery.data ?? [];

  function invalidateWorkspace() {
    void cache.invalidateQueries({ queryKey: getListTasksQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
  }

  function saveDraft(draft: TaskDraft) {
    if (!isOwner) return;
    setOperationError('');
    const data = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      status: draft.status,
      priority: draft.priority,
      dueDate: draft.dueDate || null,
    };
    if (dialogTask && dialogTask !== 'new') {
      updateTask.mutate({ id: dialogTask.id, data }, {
        onSuccess: () => {
          invalidateWorkspace();
          setDialogTask(null);
          setNotice('Đã cập nhật công việc.');
        },
        onError: handleMutationError,
      });
    } else {
      createTask.mutate({ data }, {
        onSuccess: () => {
          invalidateWorkspace();
          setDialogTask(null);
          setNotice('Đã thêm công việc mới.');
        },
        onError: handleMutationError,
      });
    }
  }

  function removeTask(task: Task) {
    if (!isOwner) return;
    if (!window.confirm(`Xóa “${task.title}”? Thao tác này không thể hoàn tác.`)) return;
    setOperationError('');
    deleteTask.mutate({ id: task.id }, {
      onSuccess: () => {
        invalidateWorkspace();
        setNotice('Đã xóa công việc.');
      },
      onError: handleMutationError,
    });
  }

  function changeStatus(task: Task) {
    if (!isOwner) return;
    const status: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    updateTask.mutate({ id: task.id, data: { status } }, {
      onSuccess: invalidateWorkspace,
      onError: handleMutationError,
    });
  }

  function handleMutationError(error: unknown) {
    setOperationError(messageFromError(error));
    if (statusCode(error) === 401 || statusCode(error) === 403) {
      cache.setQueryData(getGetCurrentAccessQueryKey(), {
        signedIn: access?.signedIn ?? false,
        isOwner: false,
        ownerConfigured: access?.ownerConfigured ?? false,
      });
      void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <Link href="/" className="brand-lockup" data-testid="link-home">
          <span className="brand-mark"><CheckCheck size={19} strokeWidth={2.5} /></span>
          <span className="brand-name">Cùng Làm</span>
        </Link>
        <div className="topbar-right">
          <span className={`access-pill ${isOwner ? 'owner' : ''}`} data-testid="status-access">
            {accessQuery.isLoading ? <LoaderCircle className="spin" size={14} /> : isOwner ? <ShieldCheck size={15} /> : <Eye size={15} />}
            {accessQuery.isLoading ? 'Đang kiểm tra quyền' : isOwner ? 'Chủ sở hữu' : 'Chỉ xem'}
          </span>
          {!accessQuery.isLoading && isOwner ? <AccountControl /> : access?.signedIn ? <AccountControl /> : (
            <div className="auth-actions">
              <Link href="/sign-in" className="topbar-signin" data-testid="link-owner-signin">Chủ sở hữu đăng nhập <ArrowUpRight size={15} /></Link>
              {access?.ownerConfigured && <Link href="/sign-up" className="signup-link" data-testid="link-owner-signup">Tạo tài khoản</Link>}
            </div>
          )}
        </div>
      </header>

      <section className="intro-grid animate-rise">
        <div className="intro-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> KHÔNG GIAN VIỆC CHUNG</div>
          <h1>Việc nhà, việc nhóm.<br /><em>Rõ ràng</em> cho tất cả.</h1>
          <p>Một danh sách chung để mọi người biết việc gì đang diễn ra — chủ sở hữu giữ quyền cập nhật, còn cả nhóm luôn nắm được tình hình.</p>
        </div>
        <div className="summary-panel">
          <div className="summary-heading">
            <div><span className="section-kicker">TỔNG QUAN</span><h2>Hôm nay của chúng ta</h2></div>
            <span className="summary-date">{todayLabel()}</span>
          </div>
          {summaryQuery.isLoading ? <SummarySkeleton /> : summaryQuery.isError ? (
            <div className="summary-error"><AlertCircle size={17} /><span>Chưa tải được thống kê.</span><button onClick={() => void summaryQuery.refetch()}>Thử lại</button></div>
          ) : (
            <div className="summary-stats" data-testid="summary-overview">
              <SummaryStat label="Tổng việc" value={summaryQuery.data?.total ?? 0} kind="total" />
              <SummaryStat label="Đang làm" value={summaryQuery.data?.inProgress ?? 0} kind="active" />
              <SummaryStat label="Hoàn tất" value={summaryQuery.data?.done ?? 0} kind="done" />
              <SummaryStat label="Quá hạn" value={summaryQuery.data?.overdue ?? 0} kind="late" />
            </div>
          )}
          <div className="summary-foot"><span className="summary-progress" /><span>{summaryQuery.data?.todo ?? 0} việc đang chờ bắt đầu</span></div>
        </div>
      </section>

      <section className="workspace-content">
        <div className="section-title-row">
          <div>
            <span className="section-kicker">BẢNG VIỆC CỦA NHÓM</span>
            <div className="title-line"><h2>Danh sách công việc</h2><span className="task-count">{summaryQuery.data?.total ?? tasks.length}</span></div>
          </div>
          {isOwner ? (
            <button className="button-primary" onClick={() => { setDialogTask('new'); setOperationError(''); }} data-testid="button-add-task">
              <Plus size={18} /> Thêm công việc
            </button>
          ) : (
            <div className="view-only-note" data-testid="text-view-only"><LockKeyhole size={15} /> Bạn đang xem danh sách</div>
          )}
        </div>

        <div className="filterbar">
          <label className="search-field">
            <Search size={17} />
            <input type="search" placeholder="Tìm công việc..." value={filters.search ?? ''} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} aria-label="Tìm công việc" data-testid="input-search-tasks" />
            {filters.search && <button className="clear-search" aria-label="Xóa tìm kiếm" onClick={() => setFilters((current) => ({ ...current, search: '' }))}><X size={15} /></button>}
          </label>
          <label className="select-wrap"><ListFilter size={15} /><select value={filters.status ?? ''} onChange={(event) => setFilters((current) => ({ ...current, status: (event.target.value || undefined) as TaskStatus | undefined }))} aria-label="Lọc theo trạng thái" data-testid="select-status-filter">
            <option value="">Mọi trạng thái</option><option value="todo">Cần làm</option><option value="in_progress">Đang làm</option><option value="done">Đã xong</option>
          </select><ChevronDown size={14} /></label>
          <label className="select-wrap"><select value={filters.priority ?? ''} onChange={(event) => setFilters((current) => ({ ...current, priority: (event.target.value || undefined) as TaskPriority | undefined }))} aria-label="Lọc theo mức ưu tiên" data-testid="select-priority-filter">
            <option value="">Mọi ưu tiên</option><option value="high">Ưu tiên cao</option><option value="medium">Ưu tiên vừa</option><option value="low">Ưu tiên thấp</option>
          </select><ChevronDown size={14} /></label>
          {(filters.search || filters.status || filters.priority) && <button className="clear-filters" onClick={() => setFilters({})} data-testid="button-clear-filters">Xóa lọc</button>}
        </div>

        {(isAccessDenied || (!accessQuery.isLoading && accessQuery.isError)) && (
          <div className={`inline-banner ${isAccessDenied ? 'soft' : 'danger'}`} role="status" data-testid="status-access-message">
            <AlertCircle size={17} />
            <span>{isAccessDenied ? 'Bạn đang ở chế độ chỉ xem. Đăng nhập bằng tài khoản chủ sở hữu để thay đổi danh sách.' : 'Không thể xác minh quyền truy cập. Các thao tác chỉnh sửa đang được khóa an toàn.'}</span>
            {isAccessDenied && !access?.signedIn && <Link href="/sign-in" data-testid="link-signin-banner">Đăng nhập <ArrowUpRight size={14} /></Link>}
            {!isAccessDenied && <button onClick={() => void accessQuery.refetch()}>Thử lại</button>}
          </div>
        )}
        {!accessQuery.isLoading && access?.ownerConfigured === false && (
          <div className="inline-banner soft" role="status" data-testid="status-owner-setup">
            <LockKeyhole size={17} />
            <span>Chưa cấu hình chủ sở hữu. Đặt OWNER_EMAIL bằng email đã xác minh của tài khoản Clerk, sau đó chủ sở hữu có thể đăng ký hoặc đăng nhập. Mọi quyền chỉnh sửa đang bị khóa.</span>
          </div>
        )}
        {operationError && <div className="inline-banner danger" role="alert" data-testid="status-mutation-error"><AlertCircle size={17} /><span>{operationError}</span><button onClick={() => setOperationError('')} aria-label="Đóng thông báo"><X size={15} /></button></div>}
        {notice && <div className="inline-banner success" role="status" data-testid="status-success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={15} /></button></div>}

        <div className="task-list" aria-live="polite">
          {tasksQuery.isLoading ? <TaskSkeletons /> : tasksQuery.isError ? (
            <div className="state-card error-state" data-testid="status-task-error">
              <span className="state-icon"><AlertCircle size={21} /></span><h3>Danh sách chưa sẵn sàng</h3><p>Không thể kết nối để tải công việc. Hãy thử lại sau.</p>
              <button className="button-secondary" onClick={() => void tasksQuery.refetch()}>Tải lại danh sách</button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="state-card empty-state" data-testid="status-empty-tasks">
              <span className="empty-art"><span className="empty-sun" /><span className="empty-paper"><Check size={22} /></span></span>
              <span className="section-kicker">{filters.search || filters.status || filters.priority ? 'KHÔNG CÓ KẾT QUẢ' : 'BẮT ĐẦU NHẸ NHÀNG'}</span>
              <h3>{filters.search || filters.status || filters.priority ? 'Chưa tìm thấy việc phù hợp' : 'Danh sách đang trống'}</h3>
              <p>{isOwner ? 'Thêm việc đầu tiên để mọi người cùng theo dõi.' : 'Khi chủ sở hữu thêm công việc, chúng sẽ xuất hiện tại đây.'}</p>
              {isOwner && !filters.search && !filters.status && !filters.priority && <button className="button-primary" onClick={() => setDialogTask('new')} data-testid="button-add-first-task"><Plus size={17} /> Tạo công việc đầu tiên</button>}
              {(filters.search || filters.status || filters.priority) && <button className="button-secondary" onClick={() => setFilters({})}>Xóa bộ lọc</button>}
            </div>
          ) : (
            <div className="task-grid">
              {tasks.map((task, index) => <TaskCard key={task.id} task={task} isOwner={isOwner} index={index} onEdit={() => setDialogTask(task)} onDelete={() => removeTask(task)} onStatus={() => changeStatus(task)} busy={updateTask.isPending || deleteTask.isPending} />)}
            </div>
          )}
        </div>
      </section>

      <footer className="workspace-footer">
        <span className="footer-brand"><span className="tiny-mark"><CheckCheck size={13} /></span> Cùng Làm</span>
        <span>Một bảng việc nhỏ, để cùng nhau nhẹ đầu hơn.</span>
        <span className="footer-access"><span className="live-dot" /> Danh sách được chia sẻ</span>
      </footer>

      {dialogTask !== null && isOwner && (
        <TaskDialog task={dialogTask === 'new' ? null : dialogTask} busy={createTask.isPending || updateTask.isPending} error={operationError} onClose={() => { setDialogTask(null); setOperationError(''); }} onSubmit={saveDraft} />
      )}
    </main>
  );
}

function AccountControl() {
  const { signOut } = useClerk();
  return <button className="account-exit" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Đăng xuất</button>;
}

function SummaryStat({ label, value, kind }: { label: string; value: number; kind: string }) {
  return <div className={`summary-stat ${kind}`} data-testid={`stat-${kind}`}><span className="stat-value">{value}</span><span className="stat-label">{label}</span></div>;
}

function SummarySkeleton() {
  return <div className="summary-stats skeleton-stats" aria-label="Đang tải tổng quan"><span /><span /><span /><span /></div>;
}

function TaskSkeletons() {
  return <div className="task-grid" aria-label="Đang tải danh sách">{[0, 1, 2, 3].map((item) => <div className="task-skeleton" key={item}><span /><span /><span /><span /></div>)}</div>;
}

function TaskCard({ task, isOwner, index, onEdit, onDelete, onStatus, busy }: {
  task: Task; isOwner: boolean; index: number; onEdit: () => void; onDelete: () => void; onStatus: () => void; busy: boolean;
}) {
  return (
    <article className={`task-card task-row ${task.status === 'done' ? 'is-done' : ''}`} style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }} data-testid={`card-task-${task.id}`}>
      <div className="task-card-top">
        <span className={`task-status ${task.status}`}><span className="status-dot" />{statusLabel(task.status)}</span>
        {task.isExample && <span className="example-badge">MẪU</span>}
        <span className={`priority-badge ${task.priority}`}>{priorityLabel(task.priority)}</span>
      </div>
      <div className="task-card-main">
        {isOwner ? (
          <button className={`complete-toggle ${task.status === 'done' ? 'checked' : ''}`} onClick={onStatus} disabled={busy} aria-label={task.status === 'done' ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành'} data-testid={`button-complete-${task.id}`}>
            {task.status === 'done' ? <Check size={14} /> : <Circle size={19} />}
          </button>
        ) : <span className="task-bullet"><Circle size={17} /></span>}
        <div className="task-copy">
          <h3 data-testid={`text-task-title-${task.id}`}>{task.title}</h3>
          {task.description && <p>{task.description}</p>}
        </div>
      </div>
      <div className="task-card-bottom">
        <span className={`due-date ${isOverdue(task.dueDate, task.status) ? 'overdue' : ''}`}><Clock3 size={14} />{task.dueDate ? formatDueDate(task.dueDate) : 'Chưa đặt hạn'}</span>
        {isOwner && <div className="task-actions">
          <button className="icon-button" onClick={onEdit} aria-label={`Sửa ${task.title}`} data-testid={`button-edit-${task.id}`}>Sửa</button>
          <button className="icon-button delete" onClick={onDelete} aria-label={`Xóa ${task.title}`} data-testid={`button-delete-${task.id}`}><Trash2 size={15} /></button>
        </div>}
      </div>
    </article>
  );
}

function TaskDialog({ task, busy, error, onClose, onSubmit }: { task: Task | null; busy: boolean; error: string; onClose: () => void; onSubmit: (draft: TaskDraft) => void }) {
  const form = useForm<TaskDraft>({
    defaultValues: task ? {
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? '',
    } : EMPTY_DRAFT,
  });
  const validation = form.formState.errors.title?.message ?? form.formState.errors.description?.message;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading"><div><span className="section-kicker">{task ? 'CHỈNH SỬA' : 'THÊM VÀO BẢNG'}</span><h2 id="dialog-title">{task ? 'Cập nhật công việc' : 'Tạo công việc mới'}</h2></div><button className="dialog-close" onClick={onClose} disabled={busy} aria-label="Đóng hộp thoại" data-testid="button-close-dialog"><X size={19} /></button></div>
        <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <label className="form-label">Tên công việc <span>*</span><input autoFocus maxLength={160} {...form.register('title', { required: 'Hãy nhập tên công việc.', maxLength: { value: 160, message: 'Tên công việc không quá 160 ký tự.' } })} placeholder="Ví dụ: Mua rau cho bữa tối" data-testid="input-task-title" /></label>
          <label className="form-label">Ghi chú <textarea maxLength={2000} rows={3} {...form.register('description', { maxLength: { value: 2000, message: 'Ghi chú không quá 2000 ký tự.' } })} placeholder="Thêm thông tin để mọi người hiểu rõ hơn..." data-testid="input-task-description" /></label>
          <div className="form-two">
            <label className="form-label">Trạng thái<select {...form.register('status')} data-testid="select-task-status"><option value="todo">Cần làm</option><option value="in_progress">Đang làm</option><option value="done">Đã xong</option></select></label>
            <label className="form-label">Mức ưu tiên<select {...form.register('priority')} data-testid="select-task-priority"><option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option></select></label>
          </div>
          <label className="form-label">Hạn hoàn thành<input type="date" {...form.register('dueDate')} data-testid="input-task-due-date" /></label>
          {(validation || error) && <p className="form-error" role="alert">{validation || error}</p>}
          <div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Hủy</button><button type="submit" className="button-primary" disabled={busy} data-testid="button-save-task">{busy && <LoaderCircle className="spin" size={16} />}{task ? 'Lưu thay đổi' : 'Tạo công việc'}</button></div>
        </form>
        </Form>
      </section>
    </div>
  );
}

function statusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const maybe = error as { status?: number; response?: { status?: number }; statusCode?: number };
  return maybe.status ?? maybe.response?.status ?? maybe.statusCode ?? null;
}

function messageFromError(error: unknown) {
  const status = statusCode(error);
  if (status === 401 || status === 403) return 'Quyền thay đổi không còn hiệu lực. Danh sách vẫn được giữ an toàn; hãy tải lại quyền truy cập.';
  return 'Chưa thể lưu thay đổi. Vui lòng thử lại.';
}

function statusLabel(status: TaskStatus) {
  return status === 'todo' ? 'Cần làm' : status === 'in_progress' ? 'Đang làm' : 'Đã xong';
}
function priorityLabel(priority: TaskPriority) {
  return priority === 'high' ? 'Ưu tiên cao' : priority === 'medium' ? 'Ưu tiên vừa' : 'Ưu tiên thấp';
}
function formatDueDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(parsed);
}
function isOverdue(date: string | null, status: TaskStatus) {
  return Boolean(date && status !== 'done' && date < new Date().toISOString().slice(0, 10));
}
function todayLabel() {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
}

export default App;
