// src/services/pwa/pwa-installer.service.ts
import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallerService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** True se il browser (Chrome/Edge su Windows) permette l'installazione come App Desktop */
  readonly canInstall = signal<boolean>(false);
  /** True se l'app sta già girando come applicazione installata standalone */
  readonly isInstalledStandalone = signal<boolean>(false);
  /** True se il dispositivo è connesso a Internet, False se è in modalità Offline / Aereo */
  readonly isOnline = signal<boolean>(navigator.onLine);

  constructor() {
    // Rileva se è già avviata come App Desktop/Tablet installata
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    this.isInstalledStandalone.set(isStandalone);

    // Intercetta il prompt nativo di installazione PWA di Windows (Edge / Chrome)
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalledStandalone.set(true);
    });

    // Monitora il passaggio Online / Offline in tempo reale
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
  }

  async installPwa(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    const choice = await this.deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    }
  }
}
