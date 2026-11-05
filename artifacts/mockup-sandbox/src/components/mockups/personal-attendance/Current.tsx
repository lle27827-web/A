import "./_group.css";
import { ArrowLeft, BookHeart, CalendarDays, ChevronLeft, ChevronRight, Home } from "lucide-react";

const shifts = [
  { date: "06/11/2026", service: "Massage đá nóng", customer: "Khách lẻ", duration: "1 giờ 30 phút", pay: "120.000 ₫" },
  { date: "06/11/2026", service: "Trị liệu", customer: "Chị Lan", duration: "1 giờ", pay: "95.000 ₫" },
  { date: "06/11/2026", service: "Massage body", customer: "Khách lẻ", duration: "2 giờ", pay: "180.000 ₫" },
];

export function Current() {
  return (
    <div className="personal">
      <header className="p-top">
        <div className="p-top-inner">
          <a className="brand" href="#"><span className="brand-mark"><BookHeart size={16} /></span>SỔ CỦA TÔI</a>
          <span className="p-pill">Riêng tư · chỉ bạn thấy</span>
          <button className="p-logout">Đăng xuất</button>
        </div>
      </header>
      <main className="p-main">
        <section className="p-hero">
          <div className="month-nav personal-month-nav">
            <button aria-label="Tháng trước"><ChevronLeft size={16} /></button>
            <div className="personal-period personal-month-summary">
              <h1>Tổng lương tháng hiện tại</h1>
              <p className="p-big">8.450.000 ₫</p>
              <span className="personal-month-period">Tháng 11/2026</span>
              <ul className="personal-month-services">
                <li>Massage đá nóng · 24 ca · 28 giờ</li>
                <li>Trị liệu · 18 ca · 22 giờ</li>
              </ul>
            </div>
            <button aria-label="Tháng sau"><ChevronRight size={16} /></button>
          </div>
          <div className="p-totals">
            <div className="p-total-card">
              <span className="rev-label">Tổng lương hôm nay</span>
              <p className="p-mid">395.000 ₫</p>
              <ul className="personal-month-services">
                <li>Massage · 2 ca · 3 giờ 30 phút</li>
                <li>Trị liệu · 1 ca · 1 giờ</li>
              </ul>
            </div>
          </div>
          <div className="p-actions"><button>＋ Ghi ca</button><button><CalendarDays size={14} /> 06/11/2026</button><button>Đối chiếu</button></div>
        </section>
        <div className="p-grid">
          <section className="p-card">
            <h2>Ca của tôi</h2>
            <div className="seg"><button className="active">Ngày</button><button>Tháng</button></div>
            <ul className="p-list">
              {shifts.map((shift) => <li className="p-row personal-shift-row" key={shift.service}>
                <time className="p-date mono">{shift.date.slice(0, 5)}</time>
                <span className="personal-shift-details"><strong>{shift.service}</strong><span>{shift.customer}</span><span className="muted">{shift.duration}</span></span>
                <strong className="p-earn">{shift.pay}</strong><span className="head-actions"><button>Sửa</button><button>Xóa</button></span>
              </li>)}
            </ul>
          </section>
          <section className="p-card">
            <h2>Dịch vụ &amp; giá của tôi</h2>
            <label className="p-switch"><input type="checkbox" /><strong>Dùng dịch vụ và tiền công của cơ sở</strong></label>
            <ul className="p-list">
              <li className="p-row"><span className="grow"><strong>Massage đá nóng</strong><span className="muted">80.000 ₫ / giờ</span></span><span className="head-actions"><button>Sửa</button><button>Xóa</button></span></li>
              <li className="p-row"><span className="grow"><strong>Trị liệu</strong><span className="muted">95.000 ₫ / giờ</span></span><span className="head-actions"><button>Sửa</button><button>Xóa</button></span></li>
              <li className="p-row"><span className="grow"><strong>Massage body</strong><span className="muted">90.000 ₫ / giờ</span></span><span className="head-actions"><button>Sửa</button><button>Xóa</button></span></li>
            </ul>
          </section>
        </div>
        <nav className="screen-nav"><button><Home size={15} /> Về sổ cơ sở</button><button><ArrowLeft size={15} /> Trở về</button></nav>
      </main>
    </div>
  );
}
