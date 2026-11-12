import {
  Bell,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  KeyRound,
  LogIn,
  LogOut,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { BRAND_CONFIG } from '../../config/brand';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { getSessionGeminiKey, setSessionGeminiKey } from '../../services/ai/geminiClient';
import {
  logoutFirebase,
  registerWithEmail,
  signInAsGuest,
  signInWithEmail,
  signInWithGoogle,
} from '../../services/firebase/authService';
import type { AppUserProfile, ExtractedTaskDraft, NotebookTask } from '../../types/notebook';
import { downloadBackupFile, parseBackupJson } from '../../utils/backupUtils';
import { SparkAmount } from '../common/SparkAmount';

interface SettingsAuthModalProps {
  open: boolean;
  user: AppUserProfile | null;
  tasks: NotebookTask[];
  firebaseReady: boolean;
  serverGeminiReady: boolean;
  remindersEnabled: boolean;
  onToggleReminders: () => Promise<void> | void;
  onImportTasks: (drafts: ExtractedTaskDraft[]) => Promise<number>;
  onClose: () => void;
  onGeminiKeyUpdated: () => void;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SettingsAuthModal({
  open,
  user,
  tasks,
  firebaseReady,
  serverGeminiReady,
  remindersEnabled,
  onToggleReminders,
  onImportTasks,
  onClose,
  onGeminiKeyUpdated,
  onNotify,
}: SettingsAuthModalProps) {
  const [devKey, setDevKey] = useState(() => getSessionGeminiKey());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const { handleBackdropClick } = useModalDismiss(open, onClose);

  if (!open) return null;

  const handleSaveDevKey = (e: FormEvent) => {
    e.preventDefault();
    setSessionGeminiKey(devKey);
    onGeminiKeyUpdated();
    onNotify(
      devKey.trim()
        ? 'Clave de prueba guardada en esta sesión para Gemini 3.8 Flash.'
        : 'Clave temporal eliminada.',
      'success'
    );
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    try {
      await signInWithGoogle();
      onNotify('Sesión iniciada con Google.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error al iniciar sesión con Google.', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setAuthLoading(true);
    try {
      await signInAsGuest();
      onNotify('Sesión de invitado conectada.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error al entrar como invitado.', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setAuthLoading(true);
    try {
      if (isRegisterMode) {
        await registerWithEmail(email.trim(), password);
        onNotify('Cuenta creada en Firebase.', 'success');
      } else {
        await signInWithEmail(email.trim(), password);
        onNotify('Sesión iniciada en Firebase.', 'success');
      }
      setPassword('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error de autenticación.', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    try {
      await logoutFirebase();
      onNotify('Sesión cerrada.', 'info');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleExportBackup = () => {
    const filename = downloadBackupFile(tasks);
    onNotify(`Copia exportada (${filename}).`, 'success');
  };

  const handleImportBackupChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportingBackup(true);
    try {
      const rawText = await file.text();
      const parsed = parseBackupJson(rawText);
      if (!parsed.ok) {
        onNotify(parsed.error, 'error');
        return;
      }
      if (parsed.tasks.length === 0) {
        onNotify('La copia no contiene tareas para importar.', 'info');
        return;
      }
      const importedCount = await onImportTasks(parsed.tasks);
      onNotify(
        importedCount === 1
          ? '1 tarea restaurada desde la copia.'
          : `${importedCount} tareas restauradas desde la copia.`,
        'success'
      );
    } catch {
      onNotify('No se pudo leer el archivo seleccionado.', 'error');
    } finally {
      setImportingBackup(false);
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0D0D0F]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conexiones y Ajustes"
        className="nb-card max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium text-[#F5F5F7]">Conexiones y Ajustes</h2>
            <p className="text-xs font-normal text-[#8E8E93]">
              Firebase Auth/Firestore · Gemini 3.8 Flash · Marca
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="rounded-full border border-[#242428] bg-[#1E1E22] p-1.5 text-[#8E8E93] transition hover:border-[#2E2E34] hover:text-[#F5F5F7]"
          >
            <X className="h-4 w-4 stroke-[1.7]" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Bloque Firebase */}
          <section className="rounded-2xl border border-[#242428] bg-[#1E1E22] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
                <h3 className="font-display text-sm font-medium text-[#F5F5F7]">
                  Firebase Auth + Firestore
                </h3>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                  firebaseReady
                    ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border border-[#242428] bg-[#161618] text-[#8E8E93]'
                }`}
              >
                {firebaseReady ? 'Configurado' : 'Modo Local'}
              </span>
            </div>

            {!firebaseReady ? (
              <div className="mt-2.5 space-y-2 text-xs font-normal leading-relaxed text-[#8E8E93]">
                <p>
                  Tus tareas y tus{' '}
                  <SparkAmount
                    value={BRAND_CONFIG.currency.initialBalance}
                    className="font-medium text-[#F5F5F7]"
                    iconClassName="h-3 w-3"
                  />{' '}
                  se guardan en local sin bloqueo.
                </p>
                <p>
                  Cuando quieras activar la nube, rellena las variables{' '}
                  <code className="text-[#F5F5F7]">VITE_FIREBASE_*</code> en{' '}
                  <code className="text-[#F5F5F7]">.env</code> y despliega{' '}
                  <code className="text-[#F5F5F7]">firestore.rules</code>.
                </p>
              </div>
            ) : user && user.provider === 'firebase' ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-[#242428] bg-[#161618] px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="h-4 w-4 stroke-[1.7] text-[#F5F5F7]" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-medium text-[#F5F5F7]">{user.displayName}</p>
                      <p className="text-[11px] font-normal text-[#8E8E93]">
                        {user.email || 'Cuenta anónima sincronizada'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={authLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#242428] bg-[#1E1E22] px-2.5 py-1 text-[11px] font-medium text-[#F5F5F7] hover:border-[#2E2E34]"
                  >
                    <LogOut className="h-3 w-3" aria-hidden="true" />
                    Salir
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={authLoading}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F5F5F7] py-2 text-xs font-medium text-[#0D0D0F] hover:bg-white disabled:opacity-45"
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                    Google
                  </button>
                  <button
                    type="button"
                    onClick={handleGuestSignIn}
                    disabled={authLoading}
                    className="rounded-xl border border-[#242428] bg-[#161618] py-2 text-xs font-medium text-[#F5F5F7] hover:border-[#2E2E34] disabled:opacity-45"
                  >
                    Entrar invitado
                  </button>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-2 border-t border-[#242428] pt-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Correo electrónico"
                    className="w-full rounded-xl border border-[#242428] bg-[#161618] px-3 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E93] focus:border-[#2E2E34] focus:outline-none"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Contraseña (mín. 6 caracteres)"
                    className="w-full rounded-xl border border-[#242428] bg-[#161618] px-3 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E93] focus:border-[#2E2E34] focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsRegisterMode((v) => !v)}
                      className="text-[11px] font-medium text-[#F5F5F7] hover:underline"
                    >
                      {isRegisterMode ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}
                    </button>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="rounded-xl bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#0D0D0F] hover:bg-white"
                    >
                      {isRegisterMode ? 'Registrarme' : 'Entrar'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>

          {/* Bloque Gemini API */}
          <section className="rounded-2xl border border-[#242428] bg-[#1E1E22] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
                <h3 className="font-display text-sm font-medium text-[#F5F5F7]">
                  Gemini API (3.8 Flash)
                </h3>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                  serverGeminiReady || Boolean(getSessionGeminiKey())
                    ? 'bg-[#F5F5F7] text-[#0D0D0F]'
                    : 'border border-[#242428] bg-[#161618] text-[#8E8E93]'
                }`}
              >
                {(serverGeminiReady || Boolean(getSessionGeminiKey())) && (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                )}
                {serverGeminiReady
                  ? 'Activa (.env)'
                  : getSessionGeminiKey()
                    ? 'Activa (Sesión)'
                    : 'Modo Demo'}
              </span>
            </div>

            <p className="mt-2 text-xs font-normal leading-relaxed text-[#8E8E93]">
              Para producción define <code className="text-[#F5F5F7]">GEMINI_API_KEY</code> en tu{' '}
              <code className="text-[#F5F5F7]">.env</code>. Si quieres probar ahora mismo sin reiniciar el servidor, pega una clave temporal de sesión:
            </p>

            <form onSubmit={handleSaveDevKey} className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8E8E93]"
                  aria-hidden="true"
                />
                <input
                  type="password"
                  value={devKey}
                  onChange={(e) => setDevKey(e.target.value)}
                  placeholder="AIza... (solo en sessionStorage)"
                  className="w-full rounded-xl border border-[#242428] bg-[#161618] py-2 pl-8 pr-3 text-xs text-[#F5F5F7] placeholder:text-[#8E8E93] focus:border-[#2E2E34] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-xl bg-[#F5F5F7] px-3 py-2 text-xs font-medium text-[#0D0D0F] hover:bg-white"
              >
                Aplicar
              </button>
            </form>
          </section>

          {/* Recordatorios inteligentes */}
          <section className="rounded-2xl border border-[#242428] bg-[#1E1E22] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.7] text-[#8E8E93]" aria-hidden="true" />
                <div>
                  <h3 className="font-display text-sm font-medium text-[#F5F5F7]">
                    Recordatorios
                  </h3>
                  <p className="mt-1 text-xs font-normal leading-relaxed text-[#8E8E93]">
                    Avisa 30 min antes de tareas con hora y 2 h antes de exámenes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={remindersEnabled}
                aria-label={remindersEnabled ? 'Desactivar recordatorios' : 'Activar recordatorios'}
                onClick={() => void onToggleReminders()}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                  remindersEnabled
                    ? 'bg-[#F5F5F7] text-[#0D0D0F] hover:bg-white'
                    : 'border border-[#242428] bg-[#161618] text-[#8E8E93] hover:border-[#2E2E34] hover:text-[#F5F5F7]'
                }`}
              >
                {remindersEnabled ? 'Activados' : 'Desactivados'}
              </button>
            </div>
          </section>

          {/* Copia de seguridad JSON */}
          <section className="rounded-2xl border border-[#242428] bg-[#1E1E22] p-4">
            <h3 className="font-display text-sm font-medium text-[#F5F5F7]">
              Copia de seguridad
            </h3>
            <p className="mt-1 text-xs font-normal leading-relaxed text-[#8E8E93]">
              Exporta o restaura tus tareas en un archivo JSON validado ({tasks.length}{' '}
              {tasks.length === 1 ? 'tarea' : 'tareas'}).
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={tasks.length === 0}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#242428] bg-[#161618] py-2 text-xs font-medium text-[#F5F5F7] transition hover:border-[#2E2E34] hover:bg-[#252529] disabled:opacity-45"
              >
                <Download className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
                Exportar JSON
              </button>
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                disabled={importingBackup}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#F5F5F7] py-2 text-xs font-medium text-[#0D0D0F] transition hover:bg-white disabled:opacity-45"
              >
                <Upload className="h-3.5 w-3.5 stroke-[1.7]" aria-hidden="true" />
                {importingBackup ? 'Importando...' : 'Importar JSON'}
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportBackupChange}
                className="hidden"
              />
            </div>
          </section>

          {/* Nota de personalización rápida */}
          <section className="rounded-2xl border border-[#242428] bg-[#1E1E22] p-3.5 text-[11px] font-normal leading-relaxed text-[#8E8E93]">
            <span className="font-medium text-[#F5F5F7]">Personalizar nombre y tomas: </span>
            Todo el branding ({BRAND_CONFIG.appName}, &ldquo;{BRAND_CONFIG.wakePhraseDisplay}&rdquo;,{' '}
            {BRAND_CONFIG.currency.namePlural}) está centralizado en{' '}
            <code className="text-[#F5F5F7]">src/config/brand.ts</code> para cambiarlo de una vez si quieres ajustar algún detalle.
          </section>
        </div>
      </div>
    </div>
  );
}
