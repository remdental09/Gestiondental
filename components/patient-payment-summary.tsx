"use client";

type PaymentSummaryEntry = {
  id: number;
  budgetId: number | null;
  amount: number;
  method: string;
  concept: string;
  date: string;
};

const paymentMethodLabel: Record<string, string> = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", transferencia: "Transferencia", otro: "Otro" };

export function PatientPaymentSummary({ payments }: { payments: PaymentSummaryEntry[] }) {
  const unlinked = payments.filter(payment => payment.budgetId === null);
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  return <div className="mt-6 border-t border-[#ebe6f6] pt-5" data-testid="patient-payments">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-semibold">Pagos y abonos</h3>
      {payments.length > 0 && <p className="text-sm text-[#625e82]">Total registrado: <strong>${total.toLocaleString("es-CL")}</strong></p>}
    </div>
    {unlinked.length > 0
      ? <>
        <h4 className="mt-3 text-sm font-medium text-[#4f4a74]">Pagos sin tratamiento asociado</h4>
        <ul className="mt-2 space-y-2">{unlinked.map(payment => <li key={payment.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-[#e4def3] p-3 text-sm"><span><strong>${payment.amount.toLocaleString("es-CL")}</strong> · {paymentMethodLabel[payment.method] ?? payment.method}{payment.concept ? " · " + payment.concept : ""}</span><span className="text-[#6e6a8c]">{payment.date}</span></li>)}</ul>
      </>
      : payments.length > 0
        ? <p className="mt-2 text-sm text-[#6e6a8c]">Los abonos vinculados se muestran dentro de cada plan de tratamiento.</p>
        : <p className="mt-2 text-sm text-[#6e6a8c]">Sin pagos registrados. Usa «Registrar pago o abono» dentro del tratamiento. El dictado no modifica el saldo sin tu confirmación.</p>}
  </div>;
}
