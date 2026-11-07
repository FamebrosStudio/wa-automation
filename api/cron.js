// Follow-up is intentionally disabled until an approved WhatsApp template,
// due-time/opt-out policy, idempotent delivery tracking, and secrets are configured.
module.exports = (req, res) => {
  res.status(503).json({
    enabled: false,
    reason: 'Follow-up delivery is not implemented; approved templates and safe idempotent scheduling are required.',
  });
};
