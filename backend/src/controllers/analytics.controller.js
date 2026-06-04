const { query } = require('../database/db');
const { logger } = require('../utils/logger');

/**
 * Anomaly detection engine for behavioral analytics.
 * Rule-based + statistical scoring for threat detection.
 */

const ANOMALY_RULES = [
  {
    name: 'BRUTE_FORCE_DETECTION',
    description: 'More than 5 failed logins in 10 minutes from same IP',
    eventType: 'LOGIN_FAILURE',
    windowMinutes: 10,
    threshold: 5,
    severity: 'HIGH',
    riskScore: 75,
  },
  {
    name: 'HIGH_VOLUME_DATA_ACCESS',
    description: 'Vendor accessed more than 20 records in 1 hour',
    eventType: 'VENDOR_DATA_ACCESS',
    windowMinutes: 60,
    threshold: 20,
    severity: 'HIGH',
    riskScore: 70,
  },
  {
    name: 'EXPIRED_TOKEN_USE',
    description: 'Attempt to use expired/revoked consent token',
    eventType: 'OUT_OF_SCOPE_ACCESS',
    windowMinutes: 60,
    threshold: 1,
    severity: 'CRITICAL',
    riskScore: 90,
  },
  {
    name: 'UNUSUAL_OFF_HOURS_ACCESS',
    description: 'Vendor data access between midnight and 5AM',
    eventType: 'VENDOR_DATA_ACCESS',
    windowMinutes: 300,
    threshold: 3,
    severity: 'MEDIUM',
    riskScore: 50,
  },
];

/**
 * Run anomaly detection across recent audit events.
 * Returns detected anomalies with risk scores.
 */
async function runAnomalyDetection(req, res) {
  try {
    const anomalies = [];

    for (const rule of ANOMALY_RULES) {
      const windowStart = new Date(Date.now() - rule.windowMinutes * 60 * 1000);

      let ruleQuery;
      let params;

      if (rule.name === 'UNUSUAL_OFF_HOURS_ACCESS') {
        ruleQuery = `
          SELECT vendor_id, COUNT(*) AS count
          FROM audit_logs
          WHERE event_type = $1
            AND created_at >= $2
            AND EXTRACT(HOUR FROM created_at) BETWEEN 0 AND 4
          GROUP BY vendor_id
          HAVING COUNT(*) >= $3
        `;
        params = [rule.eventType, windowStart, rule.threshold];
      } else {
        ruleQuery = `
          SELECT actor_id, vendor_id, ip_address, COUNT(*) AS count
          FROM audit_logs
          WHERE event_type = $1 AND created_at >= $2
          GROUP BY actor_id, vendor_id, ip_address
          HAVING COUNT(*) >= $3
        `;
        params = [rule.eventType, windowStart, rule.threshold];
      }

      const result = await query(ruleQuery, params);

      for (const row of result.rows) {
        anomalies.push({
          rule: rule.name,
          description: rule.description,
          severity: rule.severity,
          riskScore: rule.riskScore,
          actorId: row.actor_id || null,
          vendorId: row.vendor_id || null,
          ipAddress: row.ip_address || null,
          occurrenceCount: parseInt(row.count),
          windowMinutes: rule.windowMinutes,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Persist high/critical anomalies as security alerts
    for (const anomaly of anomalies.filter(a => ['HIGH', 'CRITICAL'].includes(a.severity))) {
      await query(
        `INSERT INTO security_alerts (id, alert_type, severity, actor_id, vendor_id, description, related_audit_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [require('uuid').v4(), anomaly.rule, anomaly.severity, anomaly.actorId, anomaly.vendorId, anomaly.description, []]
      );
    }

    return res.json({
      anomaliesDetected: anomalies.length,
      anomalies,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`runAnomalyDetection error: ${err.message}`);
    return res.status(500).json({ error: 'Anomaly detection failed' });
  }
}

/**
 * Get risk dashboard summary for admin.
 */
async function getRiskDashboard(req, res) {
  try {
    const [
      totalUsers, activeConsents, pendingRequests, recentAlerts,
      highRiskEvents, failedLogins24h, blockedAttempts24h
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE is_active = TRUE'),
      query("SELECT COUNT(*) FROM consent_tokens WHERE is_revoked = FALSE AND valid_until > NOW()"),
      query("SELECT COUNT(*) FROM consent_requests WHERE status = 'PENDING'"),
      query("SELECT COUNT(*) FROM security_alerts WHERE is_acknowledged = FALSE"),
      query("SELECT COUNT(*) FROM audit_logs WHERE risk_score >= 70 AND created_at >= NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*) FROM audit_logs WHERE event_type = 'LOGIN_FAILURE' AND created_at >= NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*) FROM audit_logs WHERE outcome = 'BLOCKED' AND created_at >= NOW() - INTERVAL '24 hours'"),
    ]);

    // Recent access trend (last 7 days by day)
    const trend = await query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS events, 
             SUM(CASE WHEN outcome = 'FAILURE' OR outcome = 'BLOCKED' THEN 1 ELSE 0 END) AS failures
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    return res.json({
      summary: {
        totalUsers: parseInt(totalUsers.rows[0].count),
        activeConsents: parseInt(activeConsents.rows[0].count),
        pendingConsentRequests: parseInt(pendingRequests.rows[0].count),
        unacknowledgedAlerts: parseInt(recentAlerts.rows[0].count),
        highRiskEventsLast24h: parseInt(highRiskEvents.rows[0].count),
        failedLoginsLast24h: parseInt(failedLogins24h.rows[0].count),
        blockedAttemptsLast24h: parseInt(blockedAttempts24h.rows[0].count),
      },
      accessTrend: trend.rows,
    });
  } catch (err) {
    logger.error(`getRiskDashboard error: ${err.message}`);
    return res.status(500).json({ error: 'Dashboard data fetch failed' });
  }
}

/**
 * Get per-vendor access statistics.
 */
async function getVendorAccessStats(req, res) {
  try {
    const result = await query(`
      SELECT v.id, v.name, v.vendor_type,
             COUNT(al.id) AS total_accesses,
             SUM(CASE WHEN al.outcome = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked_accesses,
             MAX(al.created_at) AS last_access,
             AVG(al.risk_score) AS avg_risk_score
      FROM vendors v
      LEFT JOIN audit_logs al ON al.vendor_id = v.id
        AND al.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY v.id, v.name, v.vendor_type
      ORDER BY avg_risk_score DESC NULLS LAST
    `);

    return res.json({ vendorStats: result.rows });
  } catch (err) {
    logger.error(`getVendorAccessStats error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch vendor stats' });
  }
}

module.exports = { runAnomalyDetection, getRiskDashboard, getVendorAccessStats };
