import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Choice, Role, Judge } from "@/p4/types";

/** 行動テキストバー or プレースホルダ */
export function ActionBar({ text }: { text: string | null }) {
  if (!text) {
    return (
      <div className="mt-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground/60">
        判定を選択…
      </div>
    );
  }
  return (
    <div className="mt-1 rounded-md bg-primary/15 px-2 py-1.5 text-base font-bold leading-tight text-foreground">
      {text}
    </div>
  );
}

/** 真/偽トグル（真=青, 偽=赤） */
export function TruthToggle({
  value,
  onChange,
}: {
  value: Choice;
  onChange: (v: Choice) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v as Choice)}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem
        value="shin"
        aria-label="真"
        className="data-[state=on]:bg-blue-600 data-[state=on]:text-white data-[state=on]:border-blue-600"
      >
        真
      </ToggleGroupItem>
      <ToggleGroupItem
        value="gi"
        aria-label="偽"
        className="data-[state=on]:bg-red-600 data-[state=on]:text-white data-[state=on]:border-red-600"
      >
        偽
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** 担当セレクタ（outline） */
export function RoleToggle({
  role,
  value,
  onChange,
}: {
  role: NonNullable<Judge["role"]>;
  value: Role;
  onChange: (v: Role) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v as Role)}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem value={role.left.value} aria-label={role.left.label}>
        {role.left.label}
      </ToggleGroupItem>
      <ToggleGroupItem value={role.right.value} aria-label={role.right.label}>
        {role.right.label}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** 真/偽トグルの入力行（ラベル＋トグル） */
export function TruthInputRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Choice;
  onChange: (v: Choice) => void;
}) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">{label}</span>
        <TruthToggle value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** 全体攻撃などのマーカー表示 */
export function MarkerNote({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {text}
    </div>
  );
}

/** 処理フローのステップ枠（番号バッジ＋ステップ名＋子要素） */
export function ProcessStep({
  index,
  name,
  children,
}: {
  index: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {index}
        </span>
        <span className="text-xs font-bold leading-tight">{name}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
