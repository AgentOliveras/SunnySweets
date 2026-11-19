import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { TrialActivationService } from './src/server/billingService';
import { StripeService } from './src/server/stripeService';

export interface DevEndpointAuthInput {
  nodeEnv?: string;
  authorizationHeader?: string;
  workspaceId?: string;
  verifyToken?: (authHeader?: string) => Promise<{ uid: string; email?: string } | null>;
  verifyOwner?: (uid: string, workspaceId: string) => Promise<boolean>;
}

export interface DevEndpointAuthResult {
  allowed: boolean;
  status: number;
  error?: string;
  uid?: string;
}

/**
 * Authorizes requests to /api/dev/* development diagnostic endpoints:
 * 1. Disabled unconditionally when NODE_ENV === 'production'.
 * 2. Requires a verified Firebase ID token via Authorization: Bearer <token>.
 * 3. Requires active workspace Owner membership on ws-main.
 */
export async function authorizeDevEndpointRequest(
  input: DevEndpointAuthInput
): Promise<DevEndpointAuthResult> {
  const effectiveEnv = input.nodeEnv ?? process.env.NODE_ENV;
  if (effectiveEnv === 'production') {
    return {
      allowed: false,
      status: 403,
      error: 'Development diagnostic endpoints are disabled in production.',
    };
  }

  const verifyTokenFn =
    input.verifyToken ?? ((hdr?: string) => TrialActivationService.verifyAuthToken(hdr));

  let verifiedUser: { uid: string; email?: string } | null = null;
  try {
    verifiedUser = await verifyTokenFn(input.authorizationHeader);
  } catch {
    verifiedUser = null;
  }

  if (!verifiedUser || !verifiedUser.uid) {
    return {
      allowed: false,
      status: 401,
      error: 'Authentication required: Valid Firebase Bearer token is required.',
    };
  }

  const targetWsId = input.workspaceId || 'ws-main';
  const verifyOwnerFn =
    input.verifyOwner ??
    ((uid: string, wsId: string) =>
      TrialActivationService.verifyWorkspaceOwnerForDev(uid, wsId));

  let isOwner = false;
  try {
    isOwner = await verifyOwnerFn(verifiedUser.uid, targetWsId);
  } catch {
    isOwner = false;
  }

  if (!isOwner) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: Active workspace Owner authorization is required.',
    };
  }

  return {
    allowed: true,
    status: 200,
    uid: verifiedUser.uid,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  app.get('/api/billing/server-time', (req, res) => {
    res.json({ serverTime: new Date().toISOString() });
  });

  app.get('/api/billing/current', async (req, res) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }
      const billing = await TrialActivationService.getBilling(workspaceId);
      res.json({ billing });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================================
  // DEVELOPMENT DIAGNOSTIC ENDPOINTS (STRICTLY DISABLED IN PROD & OWNER-ONLY)
  // ============================================================================
  app.use('/api/dev', async (req, res, next) => {
    const decision = await authorizeDevEndpointRequest({
      nodeEnv: process.env.NODE_ENV,
      authorizationHeader: req.headers.authorization,
      workspaceId: 'ws-main',
    });
    if (!decision.allowed) {
      return res.status(decision.status).json({ error: decision.error });
    }
    next();
  });

  // Development Environment ws-main Bootstrap Diagnostic Persistence
  app.post('/api/dev/bootstrap-report', (req, res) => {
    try {
      fs.writeFileSync('/tmp/bootstrap-report.json', JSON.stringify(req.body, null, 2));
      console.log('[DevBootstrap] Report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/bootstrap-report', (req, res) => {
    try {
      if (fs.existsSync('/tmp/bootstrap-report.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/bootstrap-report.json', 'utf8'));
        return res.json({ status: 'ok', report: data });
      }
      res.json({ status: 'pending', report: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Development Environment ws-main Rebind Diagnostic Persistence
  app.post('/api/dev/rebind-report', (req, res) => {
    try {
      fs.writeFileSync('/tmp/rebind-report.json', JSON.stringify(req.body, null, 2));
      console.log('[DevRebind] Report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/rebind-report', (req, res) => {
    try {
      if (fs.existsSync('/tmp/rebind-report.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/rebind-report.json', 'utf8'));
        return res.json({ status: 'ok', report: data });
      }
      res.json({ status: 'pending', report: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Development Environment ws-main Business Data Inventory Diagnostic Persistence
  app.post('/api/dev/inventory-report', (req, res) => {
    try {
      fs.writeFileSync('/tmp/inventory-report.json', JSON.stringify(req.body, null, 2));
      console.log('[DevInventory] Inventory report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/inventory-report', (req, res) => {
    try {
      if (fs.existsSync('/tmp/inventory-report.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/inventory-report.json', 'utf8'));
        return res.json({ status: 'ok', report: data });
      }
      res.json({ status: 'pending', report: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Detailed Recipe Audit Diagnostic Persistence
  app.post('/api/dev/recipe-audit', (req, res) => {
    try {
      fs.writeFileSync('/tmp/recipe-audit.json', JSON.stringify(req.body, null, 2));
      console.log('[DevRecipeAudit] Recipe audit report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/recipe-audit', (req, res) => {
    try {
      if (fs.existsSync('/tmp/recipe-audit.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/recipe-audit.json', 'utf8'));
        return res.json({ status: 'ok', audit: data });
      }
      res.json({ status: 'pending', audit: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Backup Upload Audit Diagnostic Persistence
  app.post('/api/dev/backup-audit', (req, res) => {
    try {
      fs.writeFileSync('/tmp/backup-audit.json', JSON.stringify(req.body, null, 2));
      if (req.body && req.body.rawContent) {
        fs.writeFileSync('/tmp/Sunny_Sweets_Full_Backup_2026-09-16.json', req.body.rawContent);
      }
      console.log('[DevBackupAudit] Backup audit report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/backup-audit', (req, res) => {
    try {
      if (fs.existsSync('/tmp/backup-audit.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/backup-audit.json', 'utf8'));
        return res.json({ status: 'ok', audit: data });
      }
      res.json({ status: 'pending', audit: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Live Recipe Full-Schema Baseline Endpoint (Phase 2A.11)
  app.post('/api/dev/live-recipe-baseline', (req, res) => {
    try {
      fs.writeFileSync('/tmp/live-recipe-baseline.json', JSON.stringify(req.body, null, 2));
      console.log('[DevBaseline] Live recipe baseline report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/live-recipe-baseline', (req, res) => {
    try {
      if (fs.existsSync('/tmp/live-recipe-baseline.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/live-recipe-baseline.json', 'utf8'));
        return res.json({ status: 'ok', data });
      }
      res.json({ status: 'pending', data: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Comprehensive Forensic Audit Endpoint
  app.post('/api/dev/forensic-audit', (req, res) => {
    try {
      fs.writeFileSync('/tmp/forensic-audit.json', JSON.stringify(req.body, null, 2));
      console.log('[DevForensicAudit] Forensic audit report received and persisted.');
      res.json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dev/forensic-audit', (req, res) => {
    try {
      if (fs.existsSync('/tmp/forensic-audit.json')) {
        const data = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
        return res.json({ status: 'ok', audit: data });
      }
      res.json({ status: 'pending', audit: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trusted Server-Side Trial Activation Endpoint (Section 2)
  app.post('/api/billing/start-trial', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const { workspaceId } = req.body || {};

      // Server determines authenticated UID from verified token.
      // Strictly ignores any client-supplied fake UIDs or fake dates.
      const { uid } = await TrialActivationService.verifyAuthToken(authHeader);

      const result = await TrialActivationService.startTrial({
        tokenUid: uid,
        workspaceId,
      });

      res.status(200).json(result);
    } catch (err: any) {
      const status = err.status || 500;
      const message = err.message || "We couldn't start your trial. Please try again.";
      res.status(status).json({
        error: message,
        code: err.code || 'SERVER_ERROR',
      });
    }
  });

  // Trusted Server-Side Stripe Checkout Session Creation (Phase 1.4)
  app.post('/api/billing/create-checkout-session', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const { workspaceId, planId, billingInterval } = req.body || {};

      // Server determines authenticated UID from verified token
      const { uid } = await TrialActivationService.verifyAuthToken(authHeader);

      const origin = (req.headers.origin as string) || (req.headers.referer as string);

      const result = await StripeService.createCheckoutSession({
        tokenUid: uid,
        workspaceId,
        planId,
        billingInterval,
        origin,
      });

      res.status(200).json(result);
    } catch (err: any) {
      const status = err.status || 500;
      const message = err.message || 'Failed to create checkout session.';
      res.status(status).json({
        error: message,
        code: err.code || 'CHECKOUT_SESSION_FAILED',
      });
    }
  });

  // Trusted Server-Side Strategic Partner Access Endpoints (Phase 1.2.5)
  app.post('/api/billing/strategic-partner/grant', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const { uid } = await TrialActivationService.verifyAuthToken(authHeader);

      const result = await TrialActivationService.grantStrategicPartnerAccess({
        ...req.body,
        adminUid: uid,
      });

      res.status(200).json(result);
    } catch (err: any) {
      const status = err.status || 500;
      const message = err.message || 'Failed to grant strategic partner access.';
      res.status(status).json({
        error: message,
        code: err.code || 'SERVER_ERROR',
      });
    }
  });

  app.post('/api/billing/strategic-partner/revoke', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const { uid } = await TrialActivationService.verifyAuthToken(authHeader);

      const result = await TrialActivationService.revokeStrategicPartnerAccess({
        ...req.body,
        adminUid: uid,
      });

      res.status(200).json(result);
    } catch (err: any) {
      const status = err.status || 500;
      const message = err.message || 'Failed to revoke strategic partner access.';
      res.status(status).json({
        error: message,
        code: err.code || 'SERVER_ERROR',
      });
    }
  });

  // Vite middleware in development vs static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
  startServer();
}
