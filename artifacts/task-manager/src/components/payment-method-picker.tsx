import './payment-method-picker.css';

export type PaymentMethodChoice = "cash" | "transfer";

export function PaymentMethodPicker({
  value,
  onChange,
  id,
}: {
  value: PaymentMethodChoice | "";
  onChange: (value: PaymentMethodChoice) => void;
  id: string;
}) {
  return (
    <fieldset className="field payment-method-picker" data-testid={`${id}-payment-method`}>
      <legend>Hình thức thanh toán</legend>
      <div className="payment-method-options">
        <label className="payment-method-option" htmlFor={`${id}-cash`}>
          <input id={`${id}-cash`} type="radio" name={`${id}-method`} value="cash"
            checked={value === "cash"} onChange={() => onChange("cash")} />
          <span>Tiền mặt</span>
        </label>
        <label className="payment-method-option" htmlFor={`${id}-transfer`}>
          <input id={`${id}-transfer`} type="radio" name={`${id}-method`} value="transfer"
            checked={value === "transfer"} onChange={() => onChange("transfer")} />
          <span>Chuyển khoản</span>
        </label>
      </div>
    </fieldset>
  );
}
