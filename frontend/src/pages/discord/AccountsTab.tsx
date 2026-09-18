/**
 * AccountsTab.tsx — Settings -> Discord -> Accounts.
 *
 * One row per known Discord identity (anyone who has signed in via Discord
 * at least once). Per row: the Discord identity, the panel AppUser link, the
 * ARK player link and when the pair was bound, plus the inline unlink
 * actions for the two link kinds.
 *
 * Two dialog flows:
 *   Link AppUser — combobox over /users (panel AppUsers, filtered locally).
 *   Link player  — debounced combobox over /discord/players/search.
 *
 * Both keep their error inside the dialog and leave the chosen value in
 * place, so a rejected link can be corrected without starting over. Every
 * write refreshes the table so the UI matches the database afterwards.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Link2, Link2Off, RotateCw, Save, UserCog, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Combobox,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Modal,
  NotAvailable,
  Spinner,
  Table,
  TableMessageRow,
  useConfirm,
  useToast,
} from "../../components/ui";
import {
  discordApi,
  usersApi,
  type DiscordAccount,
  type DiscordPlayerSearchHit,
} from "../../services/api";
import { extractError } from "../../utils/errors";
import { fmtDateTime } from "../../utils/format";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePending } from "../../hooks/usePending";
import type { AuthUser } from "../../types";
import styles from "./DiscordTabs.module.css";

/** Build the CDN URL for a Discord user avatar (or null when unset). */
function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  // Animated avatars start with "a_"; use .gif for those, .png otherwise.
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=64`;
}

function discordName(acc: DiscordAccount): string {
  return acc.discord_global_name || acc.discord_username || acc.discord_user_id;
}

export default function AccountsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const pending = usePending<string>();

  const [accounts, setAccounts] = useState<DiscordAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [linkAppUserFor, setLinkAppUserFor] = useState<DiscordAccount | null>(null);
  const [linkEosFor, setLinkEosFor] = useState<DiscordAccount | null>(null);

  useEffect(() => {
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAccounts(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const res = await discordApi.accounts();
      setAccounts(res.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.accounts.errors.load")));
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlinkAppUser(acc: DiscordAccount): Promise<void> {
    const ok = await confirm({
      title: t("discord.accounts.action.unlinkAppUser"),
      description: t("discord.accounts.confirmUnlinkAppUser", {
        u: acc.app_user_username ?? "?",
        d: discordName(acc),
      }),
      confirmLabel: t("discord.accounts.action.unlinkAppUser"),
      tone: "danger",
    });
    if (!ok) return;
    await pending.run(`${acc.discord_user_id}:appuser`, async () => {
      try {
        await discordApi.unlinkAppUser(acc.discord_user_id);
        toast.success(t("discord.accounts.toast.appUserUnlinked"));
        await loadAccounts();
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.accounts.errors.unlinkAppUser")));
      }
    });
  }

  async function handleUnlinkEos(acc: DiscordAccount): Promise<void> {
    const ok = await confirm({
      title: t("discord.accounts.action.unlinkEos"),
      description: t("discord.accounts.confirmUnlinkEos", {
        e: acc.eos_id ?? "?",
        d: discordName(acc),
      }),
      confirmLabel: t("discord.accounts.action.unlinkEos"),
      tone: "danger",
    });
    if (!ok) return;
    await pending.run(`${acc.discord_user_id}:eos`, async () => {
      try {
        await discordApi.unlinkEos(acc.discord_user_id);
        toast.success(t("discord.accounts.toast.eosUnlinked"));
        await loadAccounts();
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.accounts.errors.unlinkEos")));
      }
    });
  }

  return (
    <div className="l-stack">
      {error && (
        <Alert
          tone="danger"
          title={t("discord.accounts.errors.load")}
          actions={
            <Button size="sm" icon={RotateCw} onClick={() => void loadAccounts()}>
              {t("common.retry")}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card
        title={t("discord.accounts.listTitle")}
        flush
        actions={
          <Button size="sm" icon={RotateCw} onClick={() => void loadAccounts()}>
            {t("common.refresh")}
          </Button>
        }
      >
        <Table label={t("discord.accounts.listTitle")} minWidth={900}>
          <thead>
            <tr>
              <th scope="col">{t("discord.accounts.col.discord")}</th>
              <th scope="col">{t("discord.accounts.col.appUser")}</th>
              <th scope="col">{t("discord.accounts.col.player")}</th>
              <th scope="col">{t("discord.accounts.col.linkedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={4}>
                <Spinner block label={t("discord.accounts.loading")} />
              </TableMessageRow>
            ) : accounts.length === 0 ? (
              <TableMessageRow colSpan={4}>
                <EmptyState
                  icon={Users}
                  title={t("discord.accounts.emptyTitle")}
                  description={t("discord.accounts.empty")}
                />
              </TableMessageRow>
            ) : (
              accounts.map((acc) => {
                const display = discordName(acc);
                return (
                  <tr key={acc.discord_user_id}>
                    <td>
                      <div className={styles.identity}>
                        <Avatar
                          name={display}
                          src={avatarUrl(acc.discord_user_id, acc.discord_avatar)}
                          size="sm"
                        />
                        <span className="ui-cell-2">
                          <span>{display}</span>
                          <span>
                            {acc.discord_username
                              ? `@${acc.discord_username} · ${acc.discord_user_id}`
                              : acc.discord_user_id}
                          </span>
                        </span>
                      </div>
                    </td>

                    <td>
                      {acc.app_user_username ? (
                        <div className={styles.linkCell}>
                          <Badge icon={UserCog}>
                            {acc.app_user_role
                              ? t("discord.accounts.appUserWithRole", {
                                  user: acc.app_user_username,
                                  role: acc.app_user_role,
                                })
                              : acc.app_user_username}
                          </Badge>
                          <IconButton
                            size="sm"
                            icon={Link2Off}
                            tone="danger"
                            loading={pending.isPending(`${acc.discord_user_id}:appuser`)}
                            label={t("discord.accounts.unlinkAppUserFrom", { user: display })}
                            onClick={() => void handleUnlinkAppUser(acc)}
                          />
                        </div>
                      ) : (
                        <Button size="sm" icon={Link2} onClick={() => setLinkAppUserFor(acc)}>
                          {t("discord.accounts.action.linkAppUser")}
                        </Button>
                      )}
                    </td>

                    <td>
                      {acc.eos_id ? (
                        <div className={styles.linkCell}>
                          <Badge icon={Database}>
                            {/* Truncated, so the marker and the full value in
                                the tooltip say so (MASTER §9). */}
                            <span className="u-mono" title={acc.eos_id}>
                              {t("discord.common.eosShort", { id: acc.eos_id.slice(0, 8) })}
                            </span>
                          </Badge>
                          <CopyButton
                            value={acc.eos_id}
                            label={t("discord.accounts.copyEos", { user: display })}
                          />
                          <IconButton
                            size="sm"
                            icon={Link2Off}
                            tone="danger"
                            loading={pending.isPending(`${acc.discord_user_id}:eos`)}
                            label={t("discord.accounts.unlinkEosFrom", { user: display })}
                            onClick={() => void handleUnlinkEos(acc)}
                          />
                        </div>
                      ) : (
                        <Button size="sm" icon={Link2} onClick={() => setLinkEosFor(acc)}>
                          {t("discord.accounts.action.linkEos")}
                        </Button>
                      )}
                    </td>

                    <td className="u-secondary">
                      {acc.linked_at ? fmtDateTime(acc.linked_at) : <NotAvailable />}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      <LinkAppUserModal
        account={linkAppUserFor}
        onClose={() => setLinkAppUserFor(null)}
        onLinked={() => {
          setLinkAppUserFor(null);
          toast.success(t("discord.accounts.toast.appUserLinked"));
          void loadAccounts();
        }}
      />
      <LinkEosModal
        account={linkEosFor}
        onClose={() => setLinkEosFor(null)}
        onLinked={() => {
          setLinkEosFor(null);
          toast.success(t("discord.accounts.toast.eosLinked"));
          void loadAccounts();
        }}
      />
    </div>
  );
}

// ── Link AppUser dialog ──────────────────────────────────────────────────────

function LinkAppUserModal({
  account,
  onClose,
  onLinked,
}: {
  account: DiscordAccount | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<AuthUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) return;
    setFilter("");
    setChosen(null);
    setError("");
    let alive = true;
    (async () => {
      try {
        const res = await usersApi.list();
        if (alive) setUsers(res.data);
      } catch (err: unknown) {
        if (alive) setError(extractError(err, t("discord.accounts.errors.loadUsers")));
      }
    })();
    return () => {
      alive = false;
    };
    // The list is re-read each time the dialog opens for an account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = !q
      ? users
      : users.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.display_name.toLowerCase().includes(q) ||
            u.role.toLowerCase().includes(q),
        );
    return matches.slice(0, 50);
  }, [users, filter]);

  async function save(): Promise<void> {
    if (!account || !chosen || saving) return;
    setSaving(true);
    setError("");
    try {
      await discordApi.linkAppUser(account.discord_user_id, { app_user_id: chosen.id });
      onLinked();
    } catch (err: unknown) {
      // 409 "already linked to another Discord ID" belongs here, next to the
      // choice that caused it, not behind the overlay.
      setError(extractError(err, t("discord.accounts.errors.linkAppUser")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      dismissible={!saving}
      title={t("discord.accounts.modal.linkAppUserTitle", {
        d: account ? discordName(account) : "",
      })}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            loading={saving}
            loadingLabel={t("discord.accounts.modal.linking")}
            disabled={!chosen}
          >
            {t("discord.accounts.modal.linkBtn")}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label={t("discord.accounts.modal.filter")}
          hint={chosen ? t("discord.accounts.modal.chosenUser", { user: chosen.display_name }) : undefined}
        >
          <Combobox
            inputValue={filter}
            onInputChange={(value) => {
              setChosen(null);
              setFilter(value);
            }}
            options={options}
            placeholder={t("discord.accounts.modal.filterPh")}
            emptyText={t("discord.accounts.modal.noUsers")}
            getKey={(u) => String(u.id)}
            renderOption={(u) => (
              <span className={styles.option}>
                <span>{u.display_name}</span>
                <span className="u-muted u-text-sm">
                  @{u.username} · {u.role}
                </span>
              </span>
            )}
            onSelect={(u) => {
              setChosen(u);
              setFilter(u.display_name);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ── Link EOS player dialog ───────────────────────────────────────────────────

function LinkEosModal({
  account,
  onClose,
  onLinked,
}: {
  account: DiscordAccount | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DiscordPlayerSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<DiscordPlayerSearchHit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 220);

  useEffect(() => {
    if (!account) return;
    setQuery("");
    setHits([]);
    setChosen(null);
    setError("");
    setSearching(false);
  }, [account]);

  useEffect(() => {
    if (account === null) return;
    // Wait for the debounce to catch up with what is actually typed, so a
    // dialog reopened after an earlier search never queries the old text.
    if (debounced !== trimmed) return;
    if (trimmed.length < 2) {
      setHits([]);
      // The spinner is reset here too: dropping below 2 characters while a
      // request is in flight used to leave "Searching…" on screen forever.
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    (async () => {
      try {
        const res = await discordApi.searchPlayers(trimmed);
        if (alive) setHits(res.data);
      } catch (err: unknown) {
        if (alive) setError(extractError(err, t("discord.accounts.errors.search")));
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [debounced, trimmed, account, t]);

  async function save(): Promise<void> {
    if (!account || !chosen || saving) return;
    setSaving(true);
    setError("");
    try {
      await discordApi.linkEos(account.discord_user_id, chosen.eos_id);
      onLinked();
    } catch (err: unknown) {
      setError(extractError(err, t("discord.accounts.errors.linkEos")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      dismissible={!saving}
      title={t("discord.accounts.modal.linkEosTitle", {
        d: account ? discordName(account) : "",
      })}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            loading={saving}
            loadingLabel={t("discord.accounts.modal.linking")}
            disabled={!chosen}
          >
            {t("discord.accounts.modal.linkBtn")}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label={t("discord.accounts.modal.search")}
          hint={
            chosen
              ? t("discord.accounts.modal.chosenPlayer", {
                  player: chosen.name || t("discord.accounts.modal.noName"),
                  eos: chosen.eos_id,
                })
              : t("discord.accounts.modal.searchPh")
          }
        >
          <Combobox
            inputValue={query}
            onInputChange={(value) => {
              setChosen(null);
              setQuery(value);
            }}
            options={hits.slice(0, 50)}
            loading={searching}
            placeholder={t("discord.accounts.modal.searchPh")}
            emptyText={t("discord.accounts.modal.noHits")}
            getKey={(h) => h.eos_id}
            renderOption={(h) => (
              <span className={styles.option}>
                <span>{h.name || t("discord.accounts.modal.noName")}</span>
                <span className="u-muted u-text-sm u-mono">
                  {h.eos_id}
                  {h.tribe_name ? ` · ${h.tribe_name}` : ""}
                </span>
              </span>
            )}
            onSelect={(h) => {
              setChosen(h);
              setQuery(h.name || h.eos_id);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
