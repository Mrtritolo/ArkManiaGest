/**
 * TEMPORARY dev-only UI-kit harness -- delete with /uikit.html after the
 * migration. It is not imported by the app and is not a production build
 * input (vite build only bundles index.html).
 *
 * Renders every primitive in every variant and state, with theme, language
 * and player-density toggles, so the kit can be checked visually with
 * `npx vite` at /uikit.html.
 *
 * Fonts: @fontsource-variable/inter and @fontsource-variable/jetbrains-mono
 * were NOT in node_modules when this harness was written, so the page renders
 * with the system fallbacks of --font-sans / --font-mono (Segoe UI / Consolas
 * on Windows). Once the packages are installed, add here (and in main.tsx)
 * the two default entries only -- not "@fontsource-variable/inter/opsz.css",
 * which registers the same "Inter Variable" family and would download Inter
 * a second time:
 *   import "@fontsource-variable/inter";
 *   import "@fontsource-variable/jetbrains-mono";
 *
 * The ui.* strings below mirror the i18n additions proposed for en.json and
 * it.json; they are merged at runtime only because this harness must not
 * edit the locale files.
 */
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Ban,
  ChevronDown,
  Database,
  Download,
  Inbox,
  Languages,
  Moon,
  Play,
  Plus,
  RotateCw,
  Save,
  Server,
  Settings,
  Square,
  Sun,
  Trash2,
  Users,
} from "lucide-react";

import "../i18n";
import "../styles/index.css";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  buttonClass,
  Card,
  Checkbox,
  Combobox,
  ConfirmProvider,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Input,
  Meter,
  Modal,
  NotAvailable,
  PageHeader,
  Pagination,
  QualityBadge,
  SegmentedControl,
  Select,
  SortableHeader,
  Spinner,
  StatTile,
  StatusBadge,
  Switch,
  Table,
  TableMessageRow,
  Tabs,
  Textarea,
  ToastProvider,
  nextSort,
  useConfirm,
  useToast,
  type QualityTier,
  type RuntimeStatus,
  type SortState,
} from "../components/ui";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePending } from "../hooks/usePending";
import { useSelection } from "../hooks/useSelection";

// ------------------------------------------------ proposed i18n additions
const UI_EN = {
  ui: {
    dismiss: "Dismiss",
    dismissNotification: "Dismiss notification",
    notifications: "Notifications",
    copied: "Copied",
    copyFailed: "Could not copy to the clipboard",
    showPassword: "Show password",
    notAvailable: "Not available",
    noResults: "No results",
    typeToConfirm: "Type {{text}} to confirm",
    selectedCount_one: "{{count}} selected",
    selectedCount_other: "{{count}} selected",
    noneSelected: "None selected",
    pagination: { previous: "Previous", next: "Next", pageOf: "Page {{page}} of {{total}}" },
    tone: { info: "Information:", success: "Success:", warning: "Warning:", error: "Error:" },
    status: {
      online: "Online",
      offline: "Offline",
      updating: "Updating",
      crashed: "Crashed",
      error: "Error",
      degraded: "Degraded",
      testing: "Testing",
      unknown: "Unknown",
    },
    quality: {
      label: "Quality:",
      primitive: "Primitive",
      ramshackle: "Ramshackle",
      apprentice: "Apprentice",
      journeyman: "Journeyman",
      mastercraft: "Mastercraft",
      ascendant: "Ascendant",
    },
  },
};
const UI_IT = {
  ui: {
    dismiss: "Chiudi",
    dismissNotification: "Chiudi notifica",
    notifications: "Notifiche",
    copied: "Copiato",
    copyFailed: "Impossibile copiare negli appunti",
    showPassword: "Mostra password",
    notAvailable: "Non disponibile",
    noResults: "Nessun risultato",
    typeToConfirm: "Digita {{text}} per confermare",
    selectedCount_one: "{{count}} selezionato",
    selectedCount_other: "{{count}} selezionati",
    noneSelected: "Nessuna selezione",
    pagination: { previous: "Precedente", next: "Successiva", pageOf: "Pagina {{page}} di {{total}}" },
    tone: { info: "Informazione:", success: "Operazione riuscita:", warning: "Attenzione:", error: "Errore:" },
    status: {
      online: "Online",
      offline: "Offline",
      updating: "In aggiornamento",
      crashed: "Arresto anomalo",
      error: "Errore",
      degraded: "Degradato",
      testing: "Test in corso",
      unknown: "Sconosciuto",
    },
    quality: {
      label: "Qualità:",
      primitive: "Primitivo",
      ramshackle: "Scadente",
      apprentice: "Apprendista",
      journeyman: "Esperto",
      mastercraft: "Maestro",
      ascendant: "Ascendente",
    },
  },
};
i18n.addResourceBundle("en", "translation", UI_EN, true, false);
i18n.addResourceBundle("it", "translation", UI_IT, true, false);

// ------------------------------------------------------------- fixtures
interface Instance {
  id: string;
  name: string;
  map: string;
  status: RuntimeStatus;
  players: number;
  version: string;
}

const INSTANCES: Instance[] = [
  { id: "i1", name: "The Island", map: "TheIsland_WP", status: "online", players: 42, version: "v58.12" },
  { id: "i2", name: "Scorched Earth", map: "ScorchedEarth_WP", status: "updating", players: 0, version: "v58.12" },
  { id: "i3", name: "The Center", map: "TheCenter_WP", status: "crashed", players: 0, version: "v58.11" },
  { id: "i4", name: "Aberration", map: "Aberration_WP", status: "offline", players: 0, version: "v58.12" },
  { id: "i5", name: "Extinction", map: "Extinction_WP", status: "degraded", players: 17, version: "v58.12" },
];

const BLUEPRINTS = Array.from({ length: 40 }, (_, i) => ({
  path: `/Game/PrimalEarth/CoreBlueprints/Items/Armor/Riot/PrimalItemArmor_Riot${i}.PrimalItemArmor_Riot${i}`,
  name: ["Riot Helmet", "Riot Chestpiece", "Riot Gauntlets", "Riot Leggings", "Riot Boots"][i % 5] + ` ${i + 1}`,
}));

const TIERS: QualityTier[] = ["primitive", "ramshackle", "apprentice", "journeyman", "mastercraft", "ascendant"];
const STATUSES: RuntimeStatus[] = ["online", "offline", "updating", "crashed", "error", "degraded", "testing", "unknown"];
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

// --------------------------------------------------------------- layout
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="l-stack" aria-labelledby={id}>
      <h2 id={id} style={{ paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="l-stack l-stack--sm">
      <p className="u-muted u-text-sm">{label}</p>
      <div className="l-cluster">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------- sections
function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(true);
  const [metrics, setMetrics] = useState(true);
  const variants = ["primary", "secondary", "ghost", "danger"] as const;
  return (
    <Section id="s-buttons" title="Button / IconButton">
      {variants.map(variant => (
        <Row key={variant} label={`variant=${variant}: md, sm, icon, disabled, loading`}>
          <Button variant={variant}>Save changes</Button>
          <Button variant={variant} size="sm">
            Small
          </Button>
          <Button variant={variant} icon={variant === "danger" ? Trash2 : Save}>
            With icon
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
          <Button variant={variant} icon={Save} loading loadingLabel="Saving…">
            Save changes
          </Button>
        </Row>
      ))}
      <Row label="loading toggle (width locked), pressed toggle, buttonClass() on a link, danger pushed apart">
        <Button
          variant="primary"
          icon={RotateCw}
          loading={loading}
          loadingLabel="Restarting…"
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 2000);
          }}
        >
          Restart
        </Button>
        <Button pressed={pressed} onClick={() => setPressed(p => !p)}>
          Online only
        </Button>
        <Button size="sm" pressed={!pressed} onClick={() => setPressed(p => !p)}>
          Chip
        </Button>
        <a className={buttonClass({ variant: "secondary" })} href="#s-buttons">
          <Download aria-hidden="true" />
          Link as button
        </a>
        <Button variant="danger" icon={Trash2} className="u-push">
          Delete instance
        </Button>
      </Row>
      <Row label="IconButton: md, sm, tone danger, pressed, disabled, loading, disclosure (aria-expanded)">
        <IconButton icon={Settings} label="Open settings" />
        <IconButton icon={RotateCw} size="sm" label="Restart The Island" />
        <IconButton icon={Trash2} size="sm" tone="danger" label="Delete The Island" />
        <IconButton icon={Activity} label="Show metrics" pressed={metrics} onClick={() => setMetrics(m => !m)} />
        <IconButton icon={Play} size="sm" label="Start The Center" disabled />
        <IconButton icon={Square} size="sm" label="Stop Extinction" loading />
        <DisclosureDemo />
      </Row>
    </Section>
  );
}

function DisclosureDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon={ChevronDown}
        size="sm"
        label="Details for The Island"
        aria-expanded={open}
        aria-controls="demo-disclosure"
        onClick={() => setOpen(o => !o)}
      />
      <span id="demo-disclosure" hidden={!open} className="u-secondary">
        Expanded region
      </span>
    </>
  );
}

function FormsSection() {
  const [port, setPort] = useState("70000");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [map, setMap] = useState("island");
  const [agree, setAgree] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [rex, setRex] = useState(false);
  const [scope, setScope] = useState<"active" | "all">("active");
  const [target, setTarget] = useState<"plugin" | "panel">("plugin");
  const [radio, setRadio] = useState("merge");
  const portError = Number(port) > 65535 ? "Enter a port between 1 and 65535." : null;

  return (
    <Section id="s-forms" title="Field / Input / Select / Textarea / Checkbox / Switch / SegmentedControl">
      <div className="l-grid--form">
        <Field label="Server name" hint="Shown in the server browser." required>
          <Input placeholder="ArkMania The Island" />
        </Field>
        <Field label="Query port" error={portError} hint="UDP, usually 27015.">
          <Input mono inputMode="numeric" value={port} onChange={e => setPort(e.target.value)} />
        </Field>
        <Field label="Admin password">
          <Input type="password" revealable defaultValue="hunter2-hunter2" autoComplete="off" />
        </Field>
        <Field label="Map">
          <Select value={map} onChange={e => setMap(e.target.value)}>
            <option value="island">The Island</option>
            <option value="scorched">Scorched Earth</option>
            <option value="center">The Center</option>
          </Select>
        </Field>
        <Field label="Disabled input">
          <Input disabled defaultValue="Cannot edit" />
        </Field>
        <Field label="Read-only value">
          <Input readOnly mono defaultValue="7f3a9c21-eos-id" />
        </Field>
        <Field label="Message of the day" hint={`${notes.length} / 500`} className="u-span-full">
          <Textarea value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} />
        </Field>
        <Field label="Game.ini (mono editor)" className="u-span-full">
          <Textarea mono rows={4} defaultValue={"[/Script/ShooterGame.ShooterGameMode]\nMaxTribeLogs=400\nbDisableFriendlyFire=True"} />
        </Field>
      </div>
      <Row label="Standalone controls (aria-label): search md, sm input, sm select">
        <Input type="search" aria-label="Search players" placeholder="Search players" value={search} onChange={e => setSearch(e.target.value)} />
        <Input size="sm" aria-label="Price" mono defaultValue="7200" />
        <Select size="sm" aria-label="Page size" defaultValue="50">
          <option value="25">25</option>
          <option value="50">50</option>
        </Select>
      </Row>
      <Row label="Checkbox: label, description, indeterminate, disabled, aria-label only; radios">
        <Checkbox label="Accept terms" checked={agree} onChange={e => setAgree(e.target.checked)} />
        <Checkbox label="Wipe dinos" description="Removes every tamed dino on this map." defaultChecked />
        <Checkbox label="Select all" indeterminate checked={false} onChange={() => undefined} />
        <Checkbox label="Disabled" disabled />
        <Checkbox aria-label="Select The Island" />
        <Checkbox type="radio" name="mode" label="Merge" checked={radio === "merge"} onChange={() => setRadio("merge")} />
        <Checkbox type="radio" name="mode" label="Replace" checked={radio === "replace"} onChange={() => setRadio("replace")} />
      </Row>
      <div className="l-grid--form">
        <Switch label="Auto-restart on crash" description="Restarts the container within 30 seconds." checked={enabled} onChange={setEnabled} />
        <Switch label="Maintenance mode" checked={false} onChange={() => undefined} disabled />
        <div className="l-cluster">
          <span>Rex (hidden label):</span>
          <Switch label="Enable Rex" hideLabel checked={rex} onChange={setRex} />
        </div>
      </div>
      <Row label="SegmentedControl md / sm">
        <SegmentedControl
          label="Ban scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "active", label: "Active" },
            { value: "all", label: "All" },
          ]}
        />
        <SegmentedControl
          label="Database target"
          size="sm"
          value={target}
          onChange={setTarget}
          options={[
            { value: "plugin", label: "Plugin DB" },
            { value: "panel", label: "Panel DB" },
          ]}
        />
      </Row>
    </Section>
  );
}

function ComboboxDemo({ inModal = false }: { inModal?: boolean }) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [options, setOptions] = useState<typeof BLUEPRINTS>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebouncedValue(query, 250);

  useEffect(() => {
    let alive = true;
    const q = debounced.trim().toLowerCase();
    if (!q) {
      setOptions([]);
      return;
    }
    setLoading(true);
    wait(400).then(() => {
      if (!alive) return;
      setOptions(BLUEPRINTS.filter(b => b.name.toLowerCase().includes(q)).slice(0, 8));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [debounced]);

  return (
    <div className="l-stack l-stack--sm">
      <Field label={inModal ? "Blueprint (Escape closes the list, not the dialog)" : "Blueprint"} hint="Try 'riot' or 'zzz'.">
        <Combobox
          inputRef={fieldRef}
          inputValue={query}
          onInputChange={setQuery}
          options={options}
          loading={loading}
          getKey={b => b.path}
          renderOption={b => (
            <span className="l-stack" style={{ gap: 0 }}>
              <span>{b.name}</span>
              <span className="u-mono u-muted u-text-sm u-wrap-anywhere">{b.path}</span>
            </span>
          )}
          onSelect={b => {
            setChosen(b.path);
            setQuery(b.name);
          }}
          placeholder="Search blueprints"
        />
      </Field>
      <p className="u-secondary u-text-sm">
        Selected: {chosen ? <code className="ui-code">{chosen}</code> : <NotAvailable />}
      </p>
      {!inModal && (
        <div>
          <Button size="sm" onClick={() => fieldRef.current?.focus()}>
            Focus the field (inputRef)
          </Button>
        </div>
      )}
    </div>
  );
}

function OverlaysSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [modal, setModal] = useState<"sm" | "md" | "lg" | null>(null);
  const [nested, setNested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("--");
  const [nestedMode, setNestedMode] = useState<"merge" | "replace" | "skip">("replace");

  async function save(message: string) {
    setBusy(true);
    await wait(1500);
    setBusy(false);
    setModal(null);
    toast.success(message);
  }

  async function ask(kind: "default" | "danger" | "typed") {
    const ok = await confirm(
      kind === "default"
        ? { title: "Restart The Island?", description: "42 players will be disconnected.", confirmLabel: "Restart instance" }
        : kind === "danger"
          ? {
              title: "Delete machine vm-01?",
              description: (
                <>
                  <strong>vm-01</strong> and its 3 instances will be removed from the panel.
                </>
              ),
              confirmLabel: "Delete machine",
              tone: "danger",
            }
          : {
              title: "Wipe every character?",
              description: "This cannot be undone. All 1,204 characters on the cluster are deleted.",
              confirmLabel: "Wipe characters",
              tone: "danger",
              confirmText: "arkmania",
            },
    );
    setResult(`${kind}: ${ok ? "confirmed" : "cancelled"}`);
  }

  return (
    <Section id="s-overlays" title="Modal / ConfirmDialog / Toast">
      <Row label="Modal sizes, stacked, busy (dismissible=false)">
        <Button onClick={() => setModal("sm")}>Open sm</Button>
        <Button onClick={() => setModal("md")}>Open md (form + combobox)</Button>
        <Button onClick={() => setModal("lg")}>Open lg</Button>
      </Row>
      <Row label={`useConfirm (last result: ${result})`}>
        <Button onClick={() => ask("default")}>Confirm (default)</Button>
        <Button variant="danger" onClick={() => ask("danger")}>
          Confirm (danger)
        </Button>
        <Button variant="danger" onClick={() => ask("typed")}>
          Typed confirmation
        </Button>
      </Row>
      <Row label="useToast: success/info auto-dismiss 5s (pause on hover/focus); errors and toasts with an action persist; at most 3 shown, the rest wait">
        <Button onClick={() => toast.success("Instance restarted.", { title: "The Island" })}>Success</Button>
        <Button onClick={() => toast.info("Backup scheduled for 03:00.")}>Info</Button>
        <Button
          onClick={() =>
            toast.success("Ban removed for rexrider.", {
              action: { label: "Undo", onClick: () => toast.info("Ban restored.") },
            })
          }
        >
          Success with Undo (persists)
        </Button>
        <Button
          onClick={() => {
            toast.error("Backup of vm-01 failed.");
            toast.error("Backup of vm-02 failed.");
            toast.error("Backup of vm-03 failed.");
            toast.success("Backup of vm-04 finished.");
          }}
        >
          Burst: 3 errors + 1 success
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            toast.error("SSH connection to vm-01 timed out after 30 s.", {
              title: "Restart failed",
              action: { label: "Retry", onClick: () => toast.info("Retrying…") },
            })
          }
        >
          Error with action
        </Button>
      </Row>

      <Modal
        open={modal !== null}
        size={modal ?? "md"}
        title={modal === "md" ? "Add blueprint to shop" : modal === "lg" ? "Import blueprints" : "Rename instance"}
        description={modal === "sm" ? "The new name is shown in the server browser." : undefined}
        dismissible={!busy}
        onClose={() => setModal(null)}
        onSubmit={modal === "sm" ? () => void save("Renamed (submitted with Enter or Save).") : undefined}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type={modal === "sm" ? "submit" : "button"}
              loading={busy}
              loadingLabel="Saving…"
              onClick={modal === "sm" ? undefined : () => void save("Saved.")}
            >
              Save
            </Button>
          </>
        }
      >
        {modal === "sm" && (
          <Field label="Name">
            <Input defaultValue="The Island" />
          </Field>
        )}
        {modal === "md" && (
          <>
            <Alert tone="danger" title="Could not load categories">
              Errors raised while a dialog is open render inside it.
            </Alert>
            <ComboboxDemo inModal />
            <div className="l-grid--form">
              <Field label="Price">
                <Input mono defaultValue="1200" />
              </Field>
              <Field label="Quantity">
                <Input mono defaultValue="1" />
              </Field>
            </div>
            <Button onClick={() => setNested(true)}>Open a stacked dialog</Button>
          </>
        )}
        {modal === "lg" && (
          <>
            <p>A long body scrolls inside the panel while header and footer stay put.</p>
            {Array.from({ length: 30 }, (_, i) => (
              <p key={i} className="u-secondary">
                Line {i + 1}: /Game/Mods/ArkMania/Blueprints/Item_{i}.Item_{i}
              </p>
            ))}
          </>
        )}
      </Modal>
      <Modal
        open={nested}
        size="sm"
        title="Stacked dialog"
        description="Escape closes only this one; focus returns to the button in the first dialog. No footer and a radio group last: Tab and Shift+Tab stay inside."
        onClose={() => setNested(false)}
      >
        <SegmentedControl
          label="Import mode"
          value={nestedMode}
          onChange={setNestedMode}
          options={[
            { value: "merge", label: "Merge" },
            { value: "replace", label: "Replace" },
            { value: "skip", label: "Skip" },
          ]}
        />
      </Modal>
    </Section>
  );
}

function FeedbackSection() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <Section id="s-feedback" title="Alert / EmptyState / Spinner">
      <div className="l-stack">
        <Alert tone="info" title="Maintenance window">
          Servers restart every day at 05:00 CET.
        </Alert>
        <Alert tone="success">Plugin configuration saved.</Alert>
        <Alert tone="warning" title="Update pending" actions={<Button size="sm">Update now</Button>}>
          v58.13 is available for 3 instances.
        </Alert>
        {!dismissed && (
          <Alert
            tone="danger"
            title="Could not load bans"
            onDismiss={() => setDismissed(true)}
            actions={
              <Button size="sm" icon={RotateCw}>
                Retry
              </Button>
            }
          >
            The plugin database did not answer (timeout after 10 s).
          </Alert>
        )}
      </div>
      <div className="l-grid--cards">
        <Card title="Empty collection" flush>
          <EmptyState
            icon={Ban}
            title="No bans yet"
            description="Bans issued in game or from the Players page appear here."
            action={
              <Button size="sm" icon={Plus}>
                Add ban
              </Button>
            }
          />
        </Card>
        <Card title="Spinner" actions={<Spinner />}>
          <div className="l-stack">
            <Spinner />
            <Spinner label="Loading players…" />
            <Spinner block label="Loading instances…" />
          </div>
        </Card>
      </div>
    </Section>
  );
}

function DataDisplaySection() {
  const [filter, setFilter] = useState<"all" | "online">("all");
  return (
    <Section id="s-display" title="PageHeader / Card / StatTile / Badge / StatusBadge / QualityBadge / Meter / Avatar / CopyButton">
      <PageHeader
        title="Server instances"
        icon={Server}
        description="5 instances on 2 machines, updated 20 s ago"
        actions={
          <>
            <Button icon={RotateCw}>Refresh</Button>
            <Button variant="primary" icon={Plus}>
              Add instance
            </Button>
          </>
        }
      />
      <div className="l-grid--stats">
        <StatTile label="Players online" icon={Users} value={59} unit="/ 350" meta="Peak 71 today" />
        <StatTile label="Instances online" icon={Server} value={2} unit="/ 5" meta="1 crashed" metaTone="danger" href="/instances" />
        <StatTile
          label="Online filter"
          icon={Activity}
          value={filter === "online" ? "On" : "Off"}
          meta="All healthy"
          metaTone="success"
          onClick={() => setFilter(f => (f === "all" ? "online" : "all"))}
          pressed={filter === "online"}
        />
        <StatTile label="Database size" icon={Database} value="--" loading meta="Degraded replica" metaTone="warning" />
      </div>
      <Card
        title="Badges"
        icon={Settings}
        actions={<Button size="sm">Header action</Button>}
        footer={<span className="u-muted u-text-sm">Card footer</span>}
      >
        <div className="l-stack">
          <div className="l-cluster">
            <Badge>Neutral</Badge>
            <Badge tone="accent" dot>
              Accent dot
            </Badge>
            <Badge tone="success" icon={Activity}>
              Success
            </Badge>
            <Badge tone="warning" dot>
              Warning
            </Badge>
            <Badge tone="danger" icon={Ban}>
              Danger
            </Badge>
            <Badge tone="info" dot>
              Info
            </Badge>
            <span className="ui-count">128</span>
          </div>
          <div className="l-cluster">
            {STATUSES.map(s => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <div className="l-cluster">
            {TIERS.map(tier => (
              <QualityBadge key={tier} tier={tier} />
            ))}
          </div>
          <div className="l-grid--form">
            {(["accent", "success", "warning", "danger"] as const).map((tone, i) => (
              <div key={tone} className="l-stack l-stack--sm">
                <span className="u-text-sm u-secondary u-num">
                  {tone}: {25 * (i + 1)} %
                </span>
                <Meter value={25 * (i + 1)} label={`${tone} gauge`} valueText={`${25 * (i + 1)} %`} tone={tone} />
              </div>
            ))}
            <div className="l-stack l-stack--sm">
              <span className="u-text-sm u-secondary">Update progress 62 %</span>
              <Meter kind="progress" value={62} label="Update progress" valueText="62 %" />
            </div>
          </div>
          <div className="l-cluster">
            <Avatar name="Alessio" size="sm" />
            <Avatar name="rexrider" />
            <Avatar name="   " />
            <Avatar name="🦖 Dino" />
            <Avatar name="Broken image" src="/does-not-exist.png" size="lg" />
            <span className="u-mono u-text-sm">0002a8f1e9c44bf6</span>
            <CopyButton value="0002a8f1e9c44bf6" label="Copy EOS ID" />
          </div>
        </div>
      </Card>
    </Section>
  );
}

type SortKey = "name" | "players" | "status";

function TableSection() {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortState<SortKey> | null>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState("Riot Helmet");
  const [heights, setHeights] = useState("measuring…");
  const measureRef = useRef<HTMLDivElement>(null);
  const pending = usePending<string>();
  const toast = useToast();

  const rows = useMemo(() => {
    const sorted = [...INSTANCES];
    if (sort) {
      sorted.sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return sorted;
  }, [sort]);
  const selection = useSelection(rows.map(r => r.id));

  useEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const read = () => {
      const out = Array.from(root.querySelectorAll<HTMLElement>("[data-measure]")).map(
        el => `${el.dataset.measure} ${Math.round(el.getBoundingClientRect().height * 10) / 10}px`,
      );
      setHeights(out.join(" | "));
    };
    const id = window.setTimeout(read, 300);
    return () => window.clearTimeout(id);
  }, [rows]);

  return (
    <Section id="s-table" title="Table / SortableHeader / TableMessageRow / Pagination">
      <div ref={measureRef}>
        <Card
          title="Instances"
          flush
          actions={
            <>
              <span role="status" className="u-secondary u-text-sm">
                {selection.count === 0 ? t("ui.noneSelected") : t("ui.selectedCount", { count: selection.count })}
              </span>
              <Button size="sm" icon={RotateCw} disabled={selection.count === 0}>
                Restart selected
              </Button>
            </>
          }
          footer={<Pagination label="Instances pages" page={page} pageCount={3} onPageChange={setPage} />}
        >
          <Table label="Server instances" minWidth={760}>
            <thead>
              <tr data-measure="header">
                <th scope="col" style={{ width: "var(--control-touch)" }}>
                  <Checkbox
                    aria-label="Select all instances"
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                  />
                </th>
                <SortableHeader label="Name" sortKey="name" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                <SortableHeader label="Status" sortKey="status" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                <SortableHeader label="Players" sortKey="players" align="end" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                <th scope="col">Version</th>
                <th scope="col" className="u-text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} data-selected={selection.isSelected(row.id) || undefined} data-measure={index === 0 ? "two-line" : undefined}>
                  <td>
                    <Checkbox aria-label={`Select ${row.name}`} checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} />
                  </td>
                  <td>
                    <div className="ui-cell-2">
                      <span>
                        <button type="button" className="ui-row-button">
                          {row.name}
                        </button>
                      </span>
                      <span>{row.map}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="u-text-end u-num">{row.players > 0 ? row.players : <NotAvailable />}</td>
                  <td className="u-mono">{row.version}</td>
                  <td>
                    <div className="ui-row-actions">
                      <IconButton
                        size="sm"
                        icon={RotateCw}
                        label={`Restart ${row.name}`}
                        loading={pending.isPending(row.id)}
                        onClick={() => pending.run(row.id, () => wait(1500)).then(() => toast.success(`${row.name} restarted.`))}
                      />
                      <IconButton size="sm" icon={Play} label={`Start ${row.name}`} disabled={row.status === "online"} />
                      <IconButton size="sm" icon={Trash2} tone="danger" label={`Delete ${row.name}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="l-grid--cards" style={{ marginTop: "var(--space-4)" }}>
          <Card title="Single-line rows (36px) and sm input" flush>
            <Table label="Shop items">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Enabled</th>
                  <th scope="col" className="u-text-end">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr data-measure="text">
                  <td>Riot Chestpiece</td>
                  <td>
                    <Badge tone="success" icon={Activity}>
                      Yes
                    </Badge>
                  </td>
                  <td className="u-text-end u-num">4,500</td>
                </tr>
                <tr data-measure="input-sm">
                  <td>
                    <Input size="sm" aria-label="Item name" value={editing} onChange={e => setEditing(e.target.value)} />
                  </td>
                  <td>
                    <Switch label="Enable Riot Helmet" hideLabel checked onChange={() => undefined} />
                  </td>
                  <td className="u-text-end u-num">1,200</td>
                </tr>
                <tr data-measure="actions">
                  <td>Riot Boots</td>
                  <td>
                    <div className="ui-row-actions" style={{ justifyContent: "flex-start" }}>
                      <CopyButton value="PrimalItemArmor_RiotBoots" label="Copy blueprint path" />
                    </div>
                  </td>
                  <td className="u-text-end u-num">900</td>
                </tr>
              </tbody>
            </Table>
          </Card>
          <Card title="Message rows" flush>
            <Table label="Message rows">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                <TableMessageRow colSpan={2}>
                  <Spinner block label="Loading bans…" />
                </TableMessageRow>
                <TableMessageRow colSpan={2}>
                  <EmptyState icon={Inbox} title="No matches" description="Change the filters or clear the search." />
                </TableMessageRow>
                <TableMessageRow colSpan={2}>
                  <div style={{ padding: "var(--space-3)" }}>
                    <Alert tone="danger" title="Could not load bans" />
                  </div>
                </TableMessageRow>
              </tbody>
            </Table>
          </Card>
        </div>

        <Card title="Capped height (maxHeight) with sticky header" flush>
          <Table label="Leaderboard" maxHeight="14rem">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Tribe</th>
                <th scope="col" className="u-text-end">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 20 }, (_, i) => (
                <tr key={i}>
                  <td className="u-num">{i + 1}</td>
                  <td>Tribe {String.fromCharCode(65 + i)}</td>
                  <td className="u-text-end u-num">{(20 - i) * 1375}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <p className="u-mono u-text-sm u-secondary" data-testid="row-heights">
        Measured rows: {heights}
      </p>
    </Section>
  );
}

function NavigationSection() {
  const [tab, setTab] = useState("overview");
  return (
    <Section id="s-nav" title="Tabs / content classes (.ui-nav-item, .ui-dl, .ui-log, .ui-details, .ui-fieldset, .ui-actionbar, .ui-thumb)">
      <Tabs
        label="Market sections"
        value={tab}
        onChange={setTab}
        focusablePanel
        items={[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "listings", label: "Listings", count: 128 },
          { id: "requests", label: "Requests", count: 3 },
          { id: "settings", label: "Settings", icon: Settings },
        ]}
      >
        <p>
          Active tab: <strong>{tab}</strong>. Arrow keys, Home and End move between tabs.
        </p>
      </Tabs>
      <div className="l-split--rail">
        <nav aria-label="Config modules">
          <ul className="l-rail">
            {["General", "Shop", "Decay", "Rare dinos"].map((label, i) => (
              <li key={label}>
                <a className="ui-nav-item" href="#s-nav" aria-current={i === 1 ? "page" : undefined}>
                  <Settings aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="l-stack">
          <dl className="ui-dl">
            <dt>Version</dt>
            <dd className="u-mono">4.15.0</dd>
            <dt>Container</dt>
            <dd className="u-mono">asa_TheIsland_WP</dd>
            <dt>Path</dt>
            <dd className="u-mono">/opt/arkmania/cluster/TheIsland/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini</dd>
          </dl>
          <pre className="ui-log" role="log" aria-label="Server log" tabIndex={0}>
            <span className="ui-log__line">
              <span className="ui-log__time">05:00:01.120</span>
              <span className="ui-log__level">INFO</span>
              <span>Server started on port 7777</span>
            </span>
            <span className="ui-log__line ui-log__line--warn">
              <span className="ui-log__time">05:00:04.318</span>
              <span className="ui-log__level">WARN</span>
              <span>{"Tick took 212 ms (budget >= 33 ms) -> skipping frame"}</span>
            </span>
            <span className="ui-log__line ui-log__line--error">
              <span className="ui-log__time">05:02:10.007</span>
              <span className="ui-log__level">ERROR</span>
              <span>{"Plugin ArkShop != loaded: missing dependency"}</span>
            </span>
            <span className="ui-log__line ui-log__line--debug">
              <span className="ui-log__time">05:02:10.010</span>
              <span className="ui-log__level">DEBUG</span>
              <span>Retrying in 5 s</span>
            </span>
          </pre>
          <details className="ui-details">
            <summary>Advanced options</summary>
            <div className="ui-details__body">
              <fieldset className="ui-fieldset">
                <legend>Connection</legend>
                <Field label="Timeout (s)">
                  <Input mono defaultValue="30" />
                </Field>
              </fieldset>
            </div>
          </details>
          <div className="l-grid--cards">
            <div className="ui-thumb">
              <Inbox aria-hidden="true" />
            </div>
          </div>
          <div className="ui-actionbar">
            <span className="u-secondary u-text-sm">3 unsaved changes</span>
            <Button variant="ghost" className="u-push">
              Discard
            </Button>
            <Button variant="primary" icon={Save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ app
function Harness() {
  const { i18n: i18nInstance } = useTranslation();
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [player, setPlayer] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Same mechanism as the standalone player pages: the scope class goes on
  // <body>, so dialogs, confirms and toasts portaled there inherit it.
  useEffect(() => {
    if (!player) return;
    document.body.classList.add("ui-scope-player");
    return () => document.body.classList.remove("ui-scope-player");
  }, [player]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <>
      <a className="ui-skip-link" href="#main-content">
        Skip to content
      </a>
      <main id="main-content" tabIndex={-1} className="l-page">
        <PageHeader
          title="UI kit (temporary harness)"
          description="Every primitive in every state. Not part of the app or the production build."
          actions={
            <>
              <Button icon={theme === "dark" ? Sun : Moon} onClick={() => setThemeState(nextTheme)}>
                {`Switch to ${nextTheme} theme`}
              </Button>
              <Button
                icon={Languages}
                onClick={() => i18nInstance.changeLanguage(i18nInstance.language.startsWith("it") ? "en" : "it")}
              >
                {`Language: ${i18nInstance.language}`}
              </Button>
              <Button pressed={player} onClick={() => setPlayer(p => !p)}>
                Player density
              </Button>
            </>
          }
        />
        <ButtonsSection />
        <FormsSection />
        <Section id="s-combobox" title="Combobox">
          <div style={{ maxWidth: "28rem" }}>
            <ComboboxDemo />
          </div>
        </Section>
        <OverlaysSection />
        <FeedbackSection />
        <DataDisplaySection />
        <TableSection />
        <NavigationSection />
      </main>
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <Harness />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}
