import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetCurrentAccessQueryKey,
  getGetAttendanceSummaryQueryKey,
  getGetTaskSummaryQueryKey,
  getListAttendanceQueryKey,
  getListMembersQueryKey,
  getListTasksQueryKey,
  useAskAssistant,
  useCreateAttendance,
  useCreateMember,
  useCreateTask,
  useDeleteAttendance,
  useDeleteMember,
  useDeleteTask,
  useGetAttendanceSummary,
  useGetCurrentAccess,
  useGetTaskSummary,
  useListAttendance,
  useListMembers,
  useListTasks,
  useUpdateAttendance,
  useUpdateTask,
} from '@workspace/api-client-react';
import type { AttendanceInput, AttendanceRecord, AttendanceStatus, AttendanceUpdate, MemberInput, MemberRecord, Task, TaskPriority, TaskStatus } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronDown, Circle, Clock3, Eye, ListFilter, LoaderCircle, LockKeyhole, Mic, MicOff, Plus, Search, Send, ShieldCheck, Trash2, Users, X } from 'lucide-react';
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
          <Route path="/attendance" component={AttendanceHome} />
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
          <WorkspaceNav />
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

      <VoiceAssistant isOwner={isOwner} />

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

function WorkspaceNav() {
  const [location] = useLocation();
  return <nav className="workspace-nav" aria-label="Điều hướng không gian làm việc" data-testid="nav-workspace">
    <Link href="/" className={location === '/' ? 'active' : ''} aria-current={location === '/' ? 'page' : undefined} data-testid="link-tasks">Công việc</Link>
    <Link href="/attendance" className={location === '/attendance' ? 'active' : ''} aria-current={location === '/attendance' ? 'page' : undefined} data-testid="link-attendance">Chấm công</Link>
  </nav>;
}

type RecognitionAlternative = { transcript: string };
type RecognitionEvent = Event & { results: ArrayLike<ArrayLike<RecognitionAlternative>>; resultIndex: number };
type RecognitionErrorEvent = Event & { error: string };
type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ProposedAction = { kind: string; id: number | null; summary: string; payload: Record<string, unknown> };

function VoiceAssistant({ isOwner }: { isOwner: boolean }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState('');
  const [proposal, setProposal] = useState<ProposedAction | null>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const ask = useAskAssistant();
  const cache = useQueryClient();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const createMember = useCreateMember();
  const deleteMember = useDeleteMember();
  const createAttendance = useCreateAttendance();
  const updateAttendance = useUpdateAttendance();
  const deleteAttendance = useDeleteAttendance();

  useEffect(() => {
    const browser = window as Window & { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
    setSupported(Boolean((browser.SpeechRecognition || browser.webkitSpeechRecognition) && window.speechSynthesis));
    return () => { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); };
  }, []);
  function invalidateAction(kind: string) {
    if (kind.includes('task')) {
      void cache.invalidateQueries({ queryKey: getListTasksQueryKey() });
      void cache.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
    }
    if (kind.includes('attendance')) {
      void cache.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      void cache.invalidateQueries({ queryKey: getGetAttendanceSummaryQueryKey() });
    }
    if (kind.includes('member')) void cache.invalidateQueries({ queryKey: getListMembersQueryKey() });
  }
  function submitMessage(content = draft) {
    const text = content.trim();
    if (!text || ask.isPending) return;
    const next: ChatMessage[] = [...messages, { role: 'user' as const, content: text }].slice(-13);
    setMessages(next);
    setDraft('');
    setStatus('Đang gửi câu hỏi đến trợ lý.');
    ask.mutate({ data: { messages: next } }, {
      onSuccess: (response) => {
        setMessages((current) => [...current, { role: 'assistant' as const, content: response.message }].slice(-14));
        setProposal(response.action ?? null);
        setStatus('Trợ lý đã trả lời.');
        if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(response.message);
          utterance.lang = 'vi-VN';
          window.speechSynthesis.speak(utterance);
        }
      },
      onError: () => setStatus('Chưa gửi được câu hỏi. Vui lòng thử lại.'),
    });
  }
  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); setStatus('Đã dừng nghe.'); return; }
    const browser = window as Window & { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognition || !window.speechSynthesis) { setStatus('Trình duyệt này chưa hỗ trợ nhận diện và phát giọng nói.'); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = 'vi-VN'; recognition.continuous = false; recognition.interimResults = false;
      recognition.onresult = (event) => {
        const result = event.results[event.resultIndex]?.[0]?.transcript ?? '';
        if (result) { setDraft(result); setStatus('Đã nhận diện nội dung. Đang gửi đến trợ lý.'); submitMessage(result); }
      };
      recognition.onerror = (event) => {
        setListening(false);
        setStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Quyền dùng micrô bị từ chối. Hãy cho phép micrô trong cài đặt trình duyệt.' : event.error === 'audio-capture' ? 'Không tìm thấy micrô khả dụng.' : `Nhận diện giọng nói gặp lỗi (${event.error}).`);
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      setStatus('Đang nghe tiếng Việt. Hãy nói câu hỏi hoặc yêu cầu.');
      setListening(true); recognition.start();
    } catch { setListening(false); setStatus('Không thể bật micrô. Hãy kiểm tra quyền truy cập và thử lại.'); }
  }
  function executeProposal() {
    if (!isOwner || !proposal) return;
    const p = proposal.payload;
    const done = () => { invalidateAction(proposal.kind); setStatus('Đã xác nhận và hoàn tất thao tác.'); setProposal(null); };
    const failed = () => setStatus('Thao tác chưa hoàn tất. Hãy kiểm tra quyền và thử lại.');
    switch (proposal.kind) {
      case 'create_task': createTask.mutate({ data: p as never }, { onSuccess: done, onError: failed }); break;
      case 'update_task': if (proposal.id !== null) updateTask.mutate({ id: proposal.id, data: p as never }, { onSuccess: done, onError: failed }); break;
      case 'delete_task': if (proposal.id !== null && window.confirm('Xóa công việc này? Thao tác không thể hoàn tác.')) deleteTask.mutate({ id: proposal.id }, { onSuccess: done, onError: failed }); break;
      case 'create_member': createMember.mutate({ data: p as unknown as MemberInput }, { onSuccess: done, onError: failed }); break;
      case 'delete_member': if (proposal.id !== null && window.confirm('Xóa thành viên này? Lịch sử chấm công trước đây vẫn được giữ nguyên.')) deleteMember.mutate({ id: proposal.id }, { onSuccess: done, onError: failed }); break;
      case 'create_attendance': createAttendance.mutate({ data: p as unknown as AttendanceInput }, { onSuccess: done, onError: failed }); break;
      case 'update_attendance': if (proposal.id !== null) updateAttendance.mutate({ id: proposal.id, data: p as AttendanceUpdate }, { onSuccess: done, onError: failed }); break;
      case 'delete_attendance': if (proposal.id !== null && window.confirm('Xóa bản ghi chấm công này? Thao tác không thể hoàn tác.')) deleteAttendance.mutate({ id: proposal.id }, { onSuccess: done, onError: failed }); break;
      default: setProposal(null);
    }
  }
  const pending = ask.isPending || createTask.isPending || updateTask.isPending || deleteTask.isPending || createMember.isPending || deleteMember.isPending || createAttendance.isPending || updateAttendance.isPending || deleteAttendance.isPending;
  return <section className="assistant-panel" aria-labelledby="assistant-title" data-testid="panel-assistant">
    <header className="assistant-heading"><div><span className="section-kicker">TRỢ LÝ CÙNG LÀM</span><h2 id="assistant-title">Hỏi về công việc, nhóm và ca làm</h2><p>Đặt câu hỏi bằng văn bản hoặc giọng nói. Mọi thay đổi đều cần chủ sở hữu duyệt.</p></div>
      <button type="button" className={`voice-button ${listening ? 'listening' : ''}`} onClick={toggleListening} aria-pressed={listening} aria-label={listening ? 'Dừng nghe' : 'Bắt đầu nói với trợ lý'} data-testid="button-voice-toggle">{listening ? <MicOff size={17} /> : <Mic size={17} />}{listening ? 'Đang nghe' : 'Nói câu hỏi'}</button></header>
    <p className="assistant-privacy">Nội dung trò chuyện và lời nói đã nhận diện được gửi đến OpenAI thông qua Replit AI Integrations để xử lý.</p>
    <div className="assistant-thread" aria-live="polite" aria-label="Cuộc trò chuyện" data-testid="list-assistant-messages">
      {messages.length === 0 ? <p className="assistant-empty">Ví dụ: “Tuần này ai đi muộn nhiều nhất?” hoặc “Thêm thành viên tên Lan”.</p> : messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`} data-testid={`message-assistant-${index}`}><span>{message.role === 'user' ? 'Bạn' : 'Cùng Làm'}</span><p>{message.content}</p></article>)}
      {ask.isError && <p className="assistant-error" role="alert">Không thể kết nối trợ lý lúc này. Hãy thử gửi lại.</p>}
    </div>
    {proposal && <div className="assistant-proposal" data-testid="panel-assistant-proposal"><div><span className="section-kicker">ĐỀ XUẤT CHỜ DUYỆT</span><p>{proposal.summary}</p></div>{isOwner && <div className="proposal-actions"><button type="button" className="button-secondary" onClick={() => setProposal(null)} data-testid="button-reject-assistant-action">Bỏ qua</button><button type="button" className="button-primary" onClick={executeProposal} disabled={pending} data-testid="button-confirm-assistant-action">Xác nhận thao tác</button></div>}</div>}
    <form className="assistant-compose" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
      <label className="sr-only" htmlFor="assistant-message">Nhập câu hỏi cho trợ lý</label><input id="assistant-message" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} placeholder="Nhập câu hỏi bằng tiếng Việt..." disabled={pending} data-testid="input-assistant-message" />
      <button type="submit" className="button-primary" disabled={pending || !draft.trim()} aria-label="Gửi câu hỏi" data-testid="button-send-assistant">{pending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>Gửi</span></button>
    </form>
    <div className="assistant-live" aria-live="polite" aria-atomic="true" data-testid="status-assistant-live">{status || (supported ? 'Giọng nói tiếng Việt sẵn sàng; trình duyệt sẽ yêu cầu quyền micrô khi bắt đầu.' : 'Trình duyệt chưa hỗ trợ đầy đủ Web Speech API.')}</div>
  </section>;
}

function AttendanceHome() {
  const [date, setDate] = useState(localDate());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('');
  const [dialogRecord, setDialogRecord] = useState<AttendanceRecord | null | 'new'>(null);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');
  const cache = useQueryClient();
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const params = useMemo(() => {
    const result: { date?: string; search?: string; status?: AttendanceStatus } = { date };
    if (search.trim()) result.search = search.trim();
    if (statusFilter) result.status = statusFilter;
    return result;
  }, [date, search, statusFilter]);
  const summaryParams = useMemo(() => ({ date }), [date]);
  const recordsQuery = useListAttendance(params, { query: { queryKey: getListAttendanceQueryKey(params) } });
  const summaryQuery = useGetAttendanceSummary(summaryParams, { query: { queryKey: getGetAttendanceSummaryQueryKey(summaryParams) } });
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const membersQuery = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const memberHistoryParams = useMemo(() => selectedMemberId === null ? undefined : { memberId: selectedMemberId }, [selectedMemberId]);
  const memberHistoryQuery = useListAttendance(memberHistoryParams, { query: { queryKey: getListAttendanceQueryKey(memberHistoryParams) } });
  const createMember = useCreateMember();
  const deleteMember = useDeleteMember();
  const createRecord = useCreateAttendance();
  const updateRecord = useUpdateAttendance();
  const deleteRecord = useDeleteAttendance();
  const isOwner = accessQuery.data?.isOwner === true;
  const records = recordsQuery.data ?? [];
  const summary = summaryQuery.data;

  function invalidateAttendance() {
    void cache.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetAttendanceSummaryQueryKey() });
  }
  function handleError(error: unknown) {
    setOperationError(messageFromError(error));
    if (statusCode(error) === 401 || statusCode(error) === 403) {
      cache.setQueryData(getGetCurrentAccessQueryKey(), { signedIn: accessQuery.data?.signedIn ?? false, isOwner: false, ownerConfigured: accessQuery.data?.ownerConfigured ?? false });
      void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
    }
  }
  function submitAttendance(input: AttendanceInput) {
    if (!isOwner) return;
    setOperationError('');
    if (dialogRecord && dialogRecord !== 'new') {
      const data: AttendanceUpdate = input;
      updateRecord.mutate({ id: dialogRecord.id, data }, {
        onSuccess: () => { invalidateAttendance(); setDialogRecord(null); setNotice('Đã cập nhật bản ghi chấm công.'); },
        onError: handleError,
      });
    } else {
      createRecord.mutate({ data: input }, {
        onSuccess: () => { invalidateAttendance(); setDialogRecord(null); setNotice('Đã thêm bản ghi chấm công.'); },
        onError: handleError,
      });
    }
  }
  function removeAttendance(record: AttendanceRecord) {
    if (!isOwner || !window.confirm(`Xóa bản ghi của ${record.employeeName}? Thao tác này không thể hoàn tác.`)) return;
    deleteRecord.mutate({ id: record.id }, {
      onSuccess: () => { invalidateAttendance(); setNotice('Đã xóa bản ghi chấm công.'); },
      onError: handleError,
    });
  }
  return <main className="workspace">
    <header className="topbar">
      <Link href="/" className="brand-lockup" data-testid="link-home"><span className="brand-mark"><CheckCheck size={19} strokeWidth={2.5} /></span><span className="brand-name">Cùng Làm</span></Link>
      <div className="topbar-right"><WorkspaceNav /><span className={`access-pill ${isOwner ? 'owner' : ''}`} data-testid="status-access">{accessQuery.isLoading ? <LoaderCircle className="spin" size={14} /> : isOwner ? <ShieldCheck size={15} /> : <Eye size={15} />}{accessQuery.isLoading ? 'Đang kiểm tra quyền' : isOwner ? 'Chủ sở hữu' : 'Chỉ xem'}</span>
        {!accessQuery.isLoading && isOwner ? <AccountControl /> : accessQuery.data?.signedIn ? <AccountControl /> : <div className="auth-actions"><Link href="/sign-in" className="topbar-signin" data-testid="link-owner-signin">Chủ sở hữu đăng nhập <ArrowUpRight size={15} /></Link>{accessQuery.data?.ownerConfigured && <Link href="/sign-up" className="signup-link" data-testid="link-owner-signup">Tạo tài khoản</Link>}</div>}
      </div>
    </header>
    <VoiceAssistant isOwner={isOwner} />
    <MemberDirectory members={membersQuery.data ?? []} history={memberHistoryQuery.data ?? []} selectedId={selectedMemberId} isOwner={isOwner}
      loading={membersQuery.isLoading} error={membersQuery.isError} historyLoading={memberHistoryQuery.isLoading}
      onRetry={() => void membersQuery.refetch()} onSelect={setSelectedMemberId}
      onCreate={(input) => createMember.mutate({ data: input }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListMembersQueryKey() }); setNotice('Đã thêm thành viên.'); }, onError: handleError })}
      onDelete={(member) => {
        if (!window.confirm(`Xóa ${member.name}? Lịch sử chấm công trước đây vẫn được giữ nguyên và tiếp tục hiển thị trong hồ sơ của họ.`)) return;
        deleteMember.mutate({ id: member.id }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListMembersQueryKey() }); void cache.invalidateQueries({ queryKey: getListAttendanceQueryKey() }); setSelectedMemberId((current) => current === member.id ? null : current); setNotice('Đã xóa thành viên; lịch sử chấm công vẫn được giữ.'); }, onError: handleError });
      }}
      busy={createMember.isPending || deleteMember.isPending} />
    <section className="attendance-intro animate-rise">
      <div><div className="eyebrow"><span className="eyebrow-dot" /> NHỊP LÀM VIỆC CỦA NHÓM</div><h1>Chấm công <em>rõ ràng</em>,<br />cùng nhau đúng nhịp.</h1><p>Theo dõi tình hình từng ngày, để cả nhóm biết ai đã vào ca và ai cần được hỏi thăm.</p></div>
      <div className="attendance-date-card"><span className="section-kicker">NGÀY ĐANG XEM</span><label htmlFor="attendance-date">Chọn ngày</label><input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="input-attendance-date" /><span className="date-caption"><CalendarDays size={15} />{formatDate(date)}</span></div>
    </section>
    <section className="attendance-summary" aria-labelledby="attendance-summary-title">
      <div className="attendance-summary-heading"><div><span className="section-kicker">TỔNG QUAN TRONG NGÀY</span><h2 id="attendance-summary-title">{formatDate(date)}</h2></div><span className="team-total"><Users size={16} />{summary?.total ?? 0} bản ghi</span></div>
      {summaryQuery.isLoading ? <div className="attendance-stat-grid" aria-label="Đang tải thống kê chấm công">{[0,1,2,3,4,5,6].map((item) => <span className="attendance-stat-skeleton" key={item} />)}</div> : summaryQuery.isError ? <div className="inline-banner danger" role="alert" data-testid="status-attendance-summary-error"><AlertCircle size={17} /><span>Không thể tải tổng quan chấm công.</span><button onClick={() => void summaryQuery.refetch()}>Thử lại</button></div> : <div className="attendance-stat-grid" data-testid="summary-attendance">
        <AttendanceStat label="Tổng nhân sự" value={summary?.total ?? 0} tone="total" />
        <AttendanceStat label="Có mặt" value={summary?.present ?? 0} tone="present" />
        <AttendanceStat label="Đi muộn" value={summary?.late ?? 0} tone="late" />
        <AttendanceStat label="Vắng" value={summary?.absent ?? 0} tone="absent" />
        <AttendanceStat label="Nghỉ phép" value={summary?.leave ?? 0} tone="leave" />
        <AttendanceStat label="Đã vào ca" value={summary?.checkedIn ?? 0} tone="checkin" />
        <AttendanceStat label="Đã kết thúc ca" value={summary?.checkedOut ?? 0} tone="checkout" />
      </div>}
    </section>
    <section className="workspace-content attendance-content" aria-labelledby="attendance-list-title">
      <div className="section-title-row"><div><span className="section-kicker">BẢNG THEO DÕI</span><div className="title-line"><h2 id="attendance-list-title">Danh sách chấm công</h2><span className="task-count">{records.length}</span></div></div>
        {isOwner ? <button className="button-primary" onClick={() => { setDialogRecord('new'); setOperationError(''); }} data-testid="button-add-attendance"><Plus size={18} /> Thêm bản ghi</button> : <div className="view-only-note" data-testid="text-view-only"><LockKeyhole size={15} /> Bạn đang xem dữ liệu</div>}
      </div>
      <div className="filterbar attendance-filterbar">
        <label className="search-field"><Search size={17} /><input type="search" placeholder="Tìm theo tên nhân sự..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm theo tên nhân sự" data-testid="input-search-attendance" />{search && <button className="clear-search" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')} data-testid="button-clear-attendance-search"><X size={15} /></button>}</label>
        <label className="select-wrap"><ListFilter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter((event.target.value || '') as AttendanceStatus | '')} aria-label="Lọc theo tình trạng chấm công" data-testid="select-attendance-status"><option value="">Mọi tình trạng</option><option value="present">Có mặt</option><option value="late">Đi muộn</option><option value="absent">Vắng</option><option value="leave">Nghỉ phép</option></select><ChevronDown size={14} /></label>
        {(search || statusFilter) && <button className="clear-filters" onClick={() => { setSearch(''); setStatusFilter(''); }} data-testid="button-clear-attendance-filters">Xóa lọc</button>}
      </div>
      {operationError && <div className="inline-banner danger" role="alert" data-testid="status-attendance-error"><AlertCircle size={17} /><span>{operationError}</span><button onClick={() => setOperationError('')} aria-label="Đóng thông báo"><X size={15} /></button></div>}
      {notice && <div className="inline-banner success" role="status" data-testid="status-attendance-success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={15} /></button></div>}
      <div className="attendance-records" aria-live="polite">
        {recordsQuery.isLoading ? <div className="attendance-table-skeleton" aria-label="Đang tải danh sách chấm công"><span /><span /><span /><span /></div> : recordsQuery.isError ? <div className="state-card error-state" role="alert" data-testid="status-attendance-list-error"><span className="state-icon"><AlertCircle size={21} /></span><h3>Chưa tải được danh sách</h3><p>Không thể kết nối để tải dữ liệu chấm công. Hãy thử lại.</p><button className="button-secondary" onClick={() => void recordsQuery.refetch()}>Tải lại danh sách</button></div> : records.length === 0 ? <div className="state-card empty-state" data-testid="status-empty-attendance"><span className="empty-art"><span className="empty-sun" /><span className="empty-paper"><CalendarDays size={22} /></span></span><span className="section-kicker">{search || statusFilter ? 'KHÔNG CÓ KẾT QUẢ' : 'CHƯA CÓ DỮ LIỆU'}</span><h3>{search || statusFilter ? 'Chưa tìm thấy bản ghi phù hợp' : 'Ngày này chưa có bản ghi'}</h3><p>{isOwner ? 'Thêm bản ghi để nhóm cùng theo dõi tình hình trong ngày.' : 'Bản ghi sẽ xuất hiện tại đây khi chủ sở hữu cập nhật.'}</p>{isOwner && !search && !statusFilter && <button className="button-primary" onClick={() => setDialogRecord('new')} data-testid="button-add-first-attendance"><Plus size={17} /> Thêm bản ghi đầu tiên</button>}</div> : <div className="attendance-table-wrap"><table className="attendance-table"><caption>Bản ghi chấm công ngày {formatDate(date)}</caption><thead><tr><th scope="col">Nhân sự</th><th scope="col">Tình trạng</th><th scope="col">Vào ca</th><th scope="col">Tan ca</th><th scope="col">Ghi chú</th>{isOwner && <th scope="col">Thao tác</th>}</tr></thead><tbody>{records.map((record) => <tr key={record.id} data-testid={`row-attendance-${record.id}`}><th scope="row"><span className="person-cell"><span className="person-initials" aria-hidden="true">{record.employeeName.trim().slice(0, 1).toLocaleUpperCase('vi')}</span>{record.employeeName}</span></th><td><span className={`attendance-status ${record.status}`}><span className="status-dot" />{attendanceStatusLabel(record.status)}</span></td><td>{record.checkIn ?? <span className="time-empty">Chưa ghi nhận</span>}</td><td>{record.checkOut ?? <span className="time-empty">Chưa ghi nhận</span>}</td><td className="attendance-note">{record.note || '—'}</td>{isOwner && <td><div className="attendance-actions"><button className="icon-button" onClick={() => { setDialogRecord(record); setOperationError(''); }} aria-label={`Sửa bản ghi của ${record.employeeName}`} data-testid={`button-edit-attendance-${record.id}`}>Sửa</button><button className="icon-button delete" onClick={() => removeAttendance(record)} aria-label={`Xóa bản ghi của ${record.employeeName}`} data-testid={`button-delete-attendance-${record.id}`} disabled={deleteRecord.isPending}><Trash2 size={15} /></button></div></td>}</tr>)}</tbody></table></div>}
      </div>
    </section>
    <footer className="workspace-footer"><span className="footer-brand"><span className="tiny-mark"><CheckCheck size={13} /></span> Cùng Làm</span><span>Rõ nhịp mỗi ngày, nhẹ lòng cả nhóm.</span><span className="footer-access"><span className="live-dot" /> Dữ liệu chấm công được chia sẻ</span></footer>
     {dialogRecord !== null && isOwner && <AttendanceDialog record={dialogRecord === 'new' ? null : dialogRecord} busy={createRecord.isPending || updateRecord.isPending} error={operationError} initialDate={date} onClose={() => { setDialogRecord(null); setOperationError(''); }} onSubmit={submitAttendance} />}
  </main>;
}

function MemberDirectory({ members, history, selectedId, isOwner, loading, error, historyLoading, onRetry, onSelect, onCreate, onDelete, busy }: {
  members: MemberRecord[]; history: AttendanceRecord[]; selectedId: number | null; isOwner: boolean; loading: boolean; error: boolean; historyLoading: boolean;
  onRetry: () => void; onSelect: (id: number | null) => void; onCreate: (input: MemberInput) => void; onDelete: (member: MemberRecord) => void; busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const form = useForm<MemberInput>({ defaultValues: { name: '' } });
  const selected = members.find((member) => member.id === selectedId);
  function submit(values: MemberInput) {
    setFormError('');
    const name = values.name.trim();
    if (!name) { setFormError('Hãy nhập tên thành viên.'); return; }
    onCreate({ name });
    form.reset({ name: '' });
    setAdding(false);
  }
  return <section className="member-directory" aria-labelledby="member-directory-title" data-testid="section-member-directory">
    <div className="section-title-row"><div><span className="section-kicker">NHỮNG NGƯỜI CÙNG LÀM</span><div className="title-line"><h2 id="member-directory-title">Thành viên nhóm</h2><span className="task-count">{loading ? '…' : members.length}</span></div></div>
      {isOwner && <button className="button-primary" type="button" onClick={() => setAdding((value) => !value)} data-testid="button-add-member"><Plus size={17} />Thêm thành viên</button>}
    </div>
    {adding && isOwner && <div className="member-form-panel"><Form {...form}><form onSubmit={form.handleSubmit(submit)}><label className="form-label" htmlFor="member-name">Tên thành viên <span>*</span><input id="member-name" autoFocus maxLength={120} {...form.register('name', { required: 'Hãy nhập tên thành viên.', maxLength: { value: 120, message: 'Tên không quá 120 ký tự.' } })} placeholder="Ví dụ: Minh Anh" data-testid="input-member-name" /></label>{(formError || form.formState.errors.name?.message) && <p role="alert" className="form-error">{formError || form.formState.errors.name?.message}</p>}<div className="dialog-actions"><button type="button" className="button-secondary" onClick={() => { setAdding(false); setFormError(''); }}>Hủy</button><button className="button-primary" type="submit" disabled={busy} data-testid="button-save-member">{busy && <LoaderCircle className="spin" size={15} />}Lưu thành viên</button></div></form></Form></div>}
    {error ? <div className="inline-banner danger" role="alert" data-testid="status-members-error"><AlertCircle size={16} /><span>Không tải được danh sách thành viên.</span><button onClick={onRetry}>Thử lại</button></div> : loading ? <div className="member-skeleton" aria-label="Đang tải thành viên"><span /><span /><span /></div> : members.length === 0 ? <div className="member-empty" data-testid="status-empty-members"><Users size={20} /><p>Chưa có thành viên nào trong nhóm.</p>{isOwner && <span>Thêm người đầu tiên để bắt đầu ghi nhận ca làm.</span>}</div> : <div className="member-layout">
      <ul className="member-list" aria-label="Danh sách thành viên" data-testid="list-members">{members.map((member) => <li key={member.id} className={selectedId === member.id ? 'selected' : ''} data-testid={`item-member-${member.id}`}>
        <button type="button" className="member-select" onClick={() => onSelect(selectedId === member.id ? null : member.id)} aria-pressed={selectedId === member.id} aria-label={`Xem lịch sử chấm công của ${member.name}`} data-testid={`button-select-member-${member.id}`}><span className="person-initials" aria-hidden="true">{member.name.trim().slice(0, 1).toLocaleUpperCase('vi')}</span><span><strong>{member.name}</strong><small>Chọn để xem lịch sử ca</small></span><ArrowUpRight size={15} /></button>
        {isOwner && <button type="button" className="icon-button delete member-delete" onClick={() => onDelete(member)} aria-label={`Xóa ${member.name}`} data-testid={`button-delete-member-${member.id}`} disabled={busy}><Trash2 size={15} /></button>}
      </li>)}</ul>
      {selected && <section className="member-history" aria-labelledby="member-history-title" data-testid="section-member-history"><div className="member-history-heading"><div><span className="section-kicker">LỊCH SỬ CA LÀM</span><h3 id="member-history-title">{selected.name}</h3></div><button className="icon-button" type="button" onClick={() => onSelect(null)} aria-label="Đóng lịch sử" data-testid="button-close-member-history"><X size={17} /></button></div>
        {historyLoading ? <div className="member-skeleton"><span /><span /><span /></div> : history.filter((item) => item.memberId === selected.id || item.employeeName === selected.name).length === 0 ? <p className="member-history-empty">Chưa có lịch sử chấm công cho thành viên này.</p> : <div className="attendance-table-wrap"><table className="attendance-table"><caption>Tất cả ngày làm việc của {selected.name}</caption><thead><tr><th scope="col">Ngày làm việc</th><th scope="col">Tình trạng</th><th scope="col">Vào ca</th><th scope="col">Tan ca</th><th scope="col">Ghi chú</th></tr></thead><tbody>{history.filter((item) => item.memberId === selected.id || item.employeeName === selected.name).sort((a, b) => b.workDate.localeCompare(a.workDate)).map((item) => <tr key={item.id} data-testid={`row-member-history-${item.id}`}><th scope="row">{formatDate(item.workDate)}</th><td><span className={`attendance-status ${item.status}`}><span className="status-dot" />{attendanceStatusLabel(item.status)}</span></td><td>{item.checkIn ?? 'Chưa ghi nhận'}</td><td>{item.checkOut ?? 'Chưa ghi nhận'}</td><td>{item.note || '—'}</td></tr>)}</tbody></table></div>}
      </section>}
    </div>}
    <p className="member-history-note">Xóa thành viên không xóa các bản ghi chấm công cũ.</p>
  </section>;
}

function AttendanceStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`attendance-stat ${tone}`} data-testid={`stat-attendance-${tone}`}><span className="attendance-stat-value">{value}</span><span className="attendance-stat-label">{label}</span></div>;
}

function AttendanceDialog({ record, busy, error, initialDate, onClose, onSubmit }: {
  record: AttendanceRecord | null; busy: boolean; error: string; initialDate: string; onClose: () => void; onSubmit: (input: AttendanceInput) => void;
}) {
  const membersQuery = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const form = useForm<AttendanceInput>({
    defaultValues: record ? { memberId: record.memberId ?? 0, employeeName: record.employeeName, workDate: record.workDate, checkIn: record.checkIn ?? '', checkOut: record.checkOut ?? '', status: record.status, note: record.note ?? '' } : { memberId: 0, employeeName: '', workDate: initialDate, checkIn: '', checkOut: '', status: 'present', note: '' },
  });
  useEffect(() => {
    if (record) return;
    const first = membersQuery.data?.[0];
    if (first && !form.getValues('memberId')) {
      form.setValue('memberId', first.id);
      form.setValue('employeeName', first.name);
    }
  }, [form, membersQuery.data, record]);
  const validation = form.formState.errors.memberId?.message ?? form.formState.errors.employeeName?.message ?? form.formState.errors.workDate?.message;
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="task-dialog attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title" onKeyDown={(event) => {
      if (event.key === 'Tab') {
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="dialog-heading"><div><span className="section-kicker">{record ? 'CHỈNH SỬA BẢN GHI' : 'THÊM VÀO NGÀY'}</span><h2 id="attendance-dialog-title">{record ? 'Cập nhật chấm công' : 'Thêm bản ghi chấm công'}</h2></div><button type="button" className="dialog-close" onClick={onClose} disabled={busy} aria-label="Đóng hộp thoại chấm công" data-testid="button-close-attendance-dialog"><X size={19} /></button></div>
       <Form {...form}><form onSubmit={form.handleSubmit((values) => onSubmit({ ...values, employeeName: membersQuery.data?.find((member) => member.id === Number(values.memberId))?.name ?? values.employeeName.trim(), memberId: Number(values.memberId), checkIn: values.checkIn || null, checkOut: values.checkOut || null, note: values.note?.trim() || null }))}>
         <label className="form-label" htmlFor="attendance-member">Thành viên <span>*</span><select id="attendance-member" {...form.register('memberId', { valueAsNumber: true, required: 'Hãy chọn thành viên.', min: { value: 1, message: 'Hãy chọn thành viên.' }, onChange: (event) => { const member = membersQuery.data?.find((item) => item.id === Number(event.target.value)); form.setValue('employeeName', member?.name ?? ''); } })} data-testid="select-attendance-member"><option value={0}>{membersQuery.isLoading ? 'Đang tải thành viên…' : 'Chọn thành viên'}</option>{membersQuery.data?.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="form-label" htmlFor="attendance-work-date">Ngày làm việc <span>*</span><input id="attendance-work-date" type="date" {...form.register('workDate', { required: 'Hãy chọn ngày làm việc.' })} data-testid="input-attendance-work-date" /></label>
        <div className="form-two"><label className="form-label" htmlFor="attendance-check-in">Giờ vào ca<input id="attendance-check-in" type="time" {...form.register('checkIn')} data-testid="input-attendance-check-in" /></label><label className="form-label" htmlFor="attendance-check-out">Giờ tan ca<input id="attendance-check-out" type="time" {...form.register('checkOut')} data-testid="input-attendance-check-out" /></label></div>
        <label className="form-label" htmlFor="attendance-status">Tình trạng<select id="attendance-status" {...form.register('status')} data-testid="select-attendance-form-status"><option value="present">Có mặt</option><option value="late">Đi muộn</option><option value="absent">Vắng</option><option value="leave">Nghỉ phép</option></select></label>
        <label className="form-label" htmlFor="attendance-note">Ghi chú<textarea id="attendance-note" maxLength={2000} rows={3} {...form.register('note')} placeholder="Thông tin cần lưu ý trong ngày..." data-testid="input-attendance-note" /></label>
        {(validation || error) && <p className="form-error" role="alert" data-testid="status-attendance-form-error">{validation || error}</p>}
        <div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Hủy</button><button type="submit" className="button-primary" disabled={busy} data-testid="button-save-attendance">{busy && <LoaderCircle className="spin" size={16} />}{record ? 'Lưu thay đổi' : 'Thêm bản ghi'}</button></div>
      </form></Form>
    </section>
  </div>;
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
      <section className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
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
function attendanceStatusLabel(status: AttendanceStatus) {
  return status === 'present' ? 'Có mặt' : status === 'late' ? 'Đi muộn' : status === 'absent' ? 'Vắng' : 'Nghỉ phép';
}
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatDate(date: string) {
  if (!date) return 'Chưa chọn ngày';
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
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
