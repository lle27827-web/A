import './color-palette-controls.css';

export const PALETTE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'border',
  'frame-border',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'input',
  'ring',
  'ok',
  'warn',
  'info',
  'tile-background',
  'tile-foreground',
  'tile-border',
  'tile-accent',
  'detail-background',
  'detail-foreground',
  'detail-muted',
  'detail-border',
  'personal-accent',
  'search-background',
  'search-foreground',
  'search-border',
  'search-focus',
  'overlay',
  'shadow-color',
  'auth-button-background',
  'auth-button-foreground',
  'auth-button-border',
  'auth-button-hover',
] as const;

export type PaletteToken = typeof PALETTE_TOKENS[number];

export type PaletteColors = Record<PaletteToken, string>;

type ColorPaletteControlsProps = {
  colors: PaletteColors;
  onChange: (token: PaletteToken, hex: string) => void;
  onReset: () => void;
};

const groups: { title: string; description: string; tokens: { token: PaletteToken; label: string }[] }[] = [
  {
    title: 'Nền trang và chữ mặc định',
    description: 'Dùng cho nền phía sau nội dung và chữ chung. Các thẻ có nền/chữ riêng ở nhóm kế tiếp.',
    tokens: [
      { token: 'background', label: 'Nền toàn trang' },
      { token: 'foreground', label: 'Chữ mặc định trên trang' },
    ],
  },
  {
    title: 'Thẻ, bảng và khung nội dung',
    description: 'Áp dụng cho các thẻ trắng, bảng, hộp nội dung, danh sách và viền khung bao quanh.',
    tokens: [
      { token: 'card', label: 'Nền thẻ, bảng và hộp' },
      { token: 'card-foreground', label: 'Chữ bên trong thẻ/bảng' },
      { token: 'border', label: 'Viền thẻ, bảng, danh sách' },
      { token: 'frame-border', label: 'Viền khung bao quanh' },
    ],
  },
  {
    title: 'Nút, ô nhập và thao tác',
    description: 'Dùng cho nút chính/phụ, nền phụ, chữ phụ, ô nhập và viền báo vị trí đang chọn.',
    tokens: [
      { token: 'primary', label: 'Nút chính, liên kết, biểu tượng' },
      { token: 'primary-foreground', label: 'Chữ trên nút chính' },
      { token: 'secondary', label: 'Nút phụ và nền phụ' },
      { token: 'secondary-foreground', label: 'Chữ trên nút phụ' },
      { token: 'muted', label: 'Nền các vùng phụ' },
      { token: 'muted-foreground', label: 'Chữ phụ, mô tả' },
      { token: 'accent', label: 'Màu nhấn' },
      { token: 'accent-foreground', label: 'Chữ trên màu nhấn' },
      { token: 'destructive', label: 'Nút xóa/cảnh báo lỗi' },
      { token: 'destructive-foreground', label: 'Chữ trên nút xóa' },
      { token: 'input', label: 'Viền ô nhập dữ liệu' },
      { token: 'ring', label: 'Viền bàn phím/vị trí focus' },
    ],
  },
  {
    title: 'Trạng thái và thông báo',
    description: 'Màu dấu hiệu hoàn tất, cần chú ý hoặc cung cấp thông tin.',
    tokens: [
      { token: 'ok', label: 'Thành công/đã hoàn tất' },
      { token: 'warn', label: 'Cần chú ý/chênh lệch' },
      { token: 'info', label: 'Thông tin' },
    ],
  },
  {
    title: 'Thẻ điều hướng trang chính',
    description: 'Các ô lớn như Quản lý nhân viên, Quản lý thẻ, Lịch hẹn và Dịch vụ.',
    tokens: [
      { token: 'tile-background', label: 'Nền thẻ điều hướng' },
      { token: 'tile-foreground', label: 'Chữ trên thẻ điều hướng' },
      { token: 'tile-border', label: 'Viền thẻ điều hướng' },
      { token: 'tile-accent', label: 'Biểu tượng/điểm nhấn thẻ' },
    ],
  },
  {
    title: 'Chi tiết nhân viên và chấm công',
    description: 'Nền nâu và chữ bên trong cửa sổ chi tiết nhân viên, ca làm và chấm công.',
    tokens: [
      { token: 'detail-background', label: 'Nền chi tiết/chấm công' },
      { token: 'detail-foreground', label: 'Chữ chính trong chi tiết' },
      { token: 'detail-muted', label: 'Chữ phụ trong chi tiết' },
      { token: 'detail-border', label: 'Viền trong chi tiết' },
    ],
  },
  {
    title: 'Sổ chấm công cá nhân',
    description: 'Màu nhấn riêng dùng trong giao diện chấm công cá nhân.',
    tokens: [
      { token: 'personal-accent', label: 'Điểm nhấn sổ cá nhân' },
    ],
  },
  {
    title: 'Thanh tìm kiếm trên cùng',
    description: 'Chỉ áp dụng cho thanh tìm kiếm ở thanh đầu trang, gồm nền, chữ, viền và viền khi chọn.',
    tokens: [
      { token: 'search-background', label: 'Nền thanh tìm kiếm' },
      { token: 'search-foreground', label: 'Chữ và biểu tượng tìm kiếm' },
      { token: 'search-border', label: 'Viền thanh tìm kiếm' },
      { token: 'search-focus', label: 'Viền khi chạm/chọn tìm kiếm' },
    ],
  },
  {
    title: 'Cửa sổ nổi và bóng',
    description: 'Lớp tối phía sau cửa sổ bật lên và màu bóng của các khung.',
    tokens: [
      { token: 'overlay', label: 'Nền phủ sau cửa sổ' },
      { token: 'shadow-color', label: 'Màu bóng khung' },
    ],
  },
  {
    title: 'Màn hình đăng nhập',
    description: 'Màu nút đăng nhập Google trên màn hình đăng nhập; biểu tượng Google giữ màu thương hiệu.',
    tokens: [
      { token: 'auth-button-background', label: 'Nền nút đăng nhập' },
      { token: 'auth-button-foreground', label: 'Chữ nút đăng nhập' },
      { token: 'auth-button-border', label: 'Viền nút đăng nhập' },
      { token: 'auth-button-hover', label: 'Nền khi rê/chọn nút' },
    ],
  },
];

function toColorInputValue(value: string): string {
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return '#000000';
}

export function ColorPaletteControls({ colors, onChange, onReset }: ColorPaletteControlsProps) {
  return (
    <section className="palette-controls" aria-labelledby="palette-controls-title">
      <header className="palette-controls__header">
        <div>
          <p className="palette-controls__eyebrow">Tùy chỉnh giao diện</p>
          <h2 id="palette-controls-title">Bảng màu</h2>
          <p className="palette-controls__intro">
            Chọn màu bạn muốn. Mã màu hiện tại luôn được hiển thị bên cạnh mỗi ô.
          </p>
        </div>
        <button
          className="palette-controls__reset"
          type="button"
          onClick={onReset}
          data-testid="button-reset-color-palette"
        >
          Trở về màu giao diện hiện tại
        </button>
      </header>

      <div className="palette-controls__groups">
        {groups.map((group) => (
          <fieldset className="palette-controls__group" key={group.title}>
            <legend>
              <span>{group.title}</span>
              <span className="palette-controls__count">{group.tokens.length} màu</span>
            </legend>
            <p className="palette-controls__description">{group.description}</p>
            <div className="palette-controls__grid">
              {group.tokens.map(({ token, label }) => {
                const inputId = `palette-color-${token}`;
                const value = colors[token];
                return (
                  <div className="palette-controls__item" key={token}>
                    <label className="palette-controls__label" htmlFor={inputId}>
                      <span>{label}</span>
                      <code>{value}</code>
                    </label>
                    <div className="palette-controls__picker-row">
                      <input
                        id={inputId}
                        className="palette-controls__input"
                        type="color"
                        value={toColorInputValue(value)}
                        onChange={(event) => onChange(token, event.currentTarget.value)}
                        aria-label={`${label}, mã màu ${value}`}
                        data-testid={`input-color-${token}`}
                      />
                      <span className="palette-controls__token" aria-hidden="true">
                        --{token}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="palette-controls__note">
        Màu được áp dụng bởi phần cài đặt giao diện của ứng dụng.
      </p>
    </section>
  );
}
