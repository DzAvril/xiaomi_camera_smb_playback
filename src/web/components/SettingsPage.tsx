import { Eye, EyeOff, KeyRound, Save } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { CameraStream } from "../../shared/types";
import { cameraFormatters } from "./CameraSidebar";

type CameraUpdate = {
  alias: string;
  enabled: boolean;
};

type CameraDraft = CameraUpdate;

type CameraSaveState = "idle" | "saving" | "saved" | "error";

type SettingsPageProps = {
  cameras: CameraStream[];
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onUpdateCamera(cameraId: string, update: CameraUpdate): Promise<void>;
};

function buildDrafts(cameras: CameraStream[]): Record<string, CameraDraft> {
  return Object.fromEntries(cameras.map((camera) => [camera.id, { alias: camera.alias, enabled: camera.enabled }]));
}

function hasCameraChanges(camera: CameraStream, draft: CameraDraft | undefined): boolean {
  return Boolean(draft && (draft.alias.trim() !== camera.alias || draft.enabled !== camera.enabled));
}

export function SettingsPage({ cameras, onChangePassword, onUpdateCamera }: SettingsPageProps) {
  const [drafts, setDrafts] = useState<Record<string, CameraDraft>>(() => buildDrafts(cameras));
  const [cameraSaveState, setCameraSaveState] = useState<CameraSaveState>("idle");
  const [cameraStatus, setCameraStatus] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    setDrafts(buildDrafts(cameras));
  }, [cameras]);

  const cameraSummary = useMemo(() => {
    const enabled = cameras.filter((camera) => camera.enabled).length;
    return `${enabled} of ${cameras.length} visible`;
  }, [cameras]);

  const changedCameras = useMemo(
    () => cameras.filter((camera) => hasCameraChanges(camera, drafts[camera.id])),
    [cameras, drafts],
  );

  function updateDraft(cameraId: string, update: Partial<CameraDraft>) {
    setDrafts((current) => ({
      ...current,
      [cameraId]: {
        ...(current[cameraId] ?? { alias: "", enabled: true }),
        ...update,
      },
    }));
    setCameraSaveState("idle");
    setCameraStatus(null);
  }

  async function saveCameraSettings() {
    if (changedCameras.length === 0 || cameraSaveState === "saving") {
      return;
    }

    const updates = changedCameras.map((camera) => {
      const draft = drafts[camera.id] ?? { alias: camera.alias, enabled: camera.enabled };
      return {
        camera,
        update: {
          alias: draft.alias.trim(),
          enabled: draft.enabled,
        },
      };
    });

    if (updates.some(({ update }) => !update.alias)) {
      setCameraSaveState("error");
      setCameraStatus("Alias cannot be empty");
      return;
    }

    setCameraSaveState("saving");
    setCameraStatus(null);

    try {
      await Promise.all(updates.map(({ camera, update }) => onUpdateCamera(camera.id, update)));
      setCameraSaveState("saved");
      setCameraStatus(`Saved ${updates.length} ${updates.length === 1 ? "camera" : "cameras"}`);
    } catch {
      setCameraSaveState("error");
      setCameraStatus("Save failed");
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordStatus(null);

    if (!currentPassword || !newPassword) {
      setPasswordStatus("Fill in both password fields");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordStatus("New password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmedPassword) {
      setPasswordStatus("Passwords do not match");
      return;
    }

    setIsChangingPassword(true);

    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmedPassword("");
      setPasswordStatus("Password updated");
    } catch (passwordError) {
      setPasswordStatus(passwordError instanceof Error ? passwordError.message : "Password update failed");
    } finally {
      setIsChangingPassword(false);
    }
  }

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-grid">
        <section className="settings-section" aria-labelledby="mounted-streams-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Mounted streams</p>
              <h2 id="mounted-streams-title">Cameras</h2>
            </div>
            <div className="camera-settings-actions">
              <strong>{cameraSummary}</strong>
              <button
                className="icon-button settings-save-button"
                disabled={changedCameras.length === 0 || cameraSaveState === "saving"}
                onClick={() => void saveCameraSettings()}
                type="button"
              >
                <Save aria-hidden="true" size={15} />
                {cameraSaveState === "saving" ? "Saving" : "Save configuration"}
              </button>
            </div>
          </div>

          {cameraStatus ? <div className={`settings-status is-${cameraSaveState}`} role="status">{cameraStatus}</div> : null}

          <div className="camera-settings-list">
            {cameras.length === 0 ? (
              <div className="empty-state">No mounted streams indexed</div>
            ) : (
              cameras.map((camera) => {
                const draft = drafts[camera.id] ?? { alias: camera.alias, enabled: camera.enabled };

                return (
                  <section className="camera-settings-card" aria-label={`Camera setting ${camera.alias}`} key={camera.id}>
                    <div className="camera-settings-title">
                      <div>
                        <strong>{camera.alias}</strong>
                        <span>
                          {camera.rootPath} · channel {camera.channel}
                        </span>
                      </div>
                      <span className={`visibility-pill${draft.enabled ? " is-visible" : ""}`}>
                        {draft.enabled ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
                        {draft.enabled ? "Visible" : "Hidden"}
                      </span>
                    </div>

                    <div className="camera-settings-controls">
                      <label className="settings-field">
                        <span>Alias</span>
                        <input
                          aria-label="Alias"
                          onChange={(event) => updateDraft(camera.id, { alias: event.target.value })}
                          value={draft.alias}
                        />
                      </label>

                      <label className="settings-toggle">
                        <input
                          aria-label="Show in playback"
                          checked={draft.enabled}
                          onChange={(event) => updateDraft(camera.id, { enabled: event.target.checked })}
                          type="checkbox"
                        />
                        <span>Show in playback</span>
                      </label>
                    </div>

                    <div className="camera-settings-footer">
                      <span>{camera.clipCount} clips</span>
                      <span>{cameraFormatters.formatDuration(camera.totalSeconds)}</span>
                      <span>{cameraFormatters.formatBytes(camera.totalBytes)}</span>
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </section>

        <section className="settings-section password-settings" aria-labelledby="password-settings-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Access</p>
              <h2 id="password-settings-title">Password</h2>
            </div>
            <KeyRound aria-hidden="true" size={21} />
          </div>

          <form className="password-settings-form" onSubmit={submitPassword}>
            <label className="settings-field">
              <span>Current password</span>
              <input
                aria-label="Current password"
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                type="password"
                value={currentPassword}
              />
            </label>

            <label className="settings-field">
              <span>New password</span>
              <input
                aria-label="New password"
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                value={newPassword}
              />
            </label>

            <label className="settings-field">
              <span>Confirm new password</span>
              <input
                aria-label="Confirm new password"
                autoComplete="new-password"
                onChange={(event) => setConfirmedPassword(event.target.value)}
                type="password"
                value={confirmedPassword}
              />
            </label>

            {passwordStatus ? <div className="settings-status" role="status">{passwordStatus}</div> : null}

            <button className="icon-button password-save-button" disabled={isChangingPassword} type="submit">
              <KeyRound aria-hidden="true" size={15} />
              Change password
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
