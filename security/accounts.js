'use strict';

// Keep reports for the active verified account; archive inactive reports without deleting them.
function selectReportAccount(config, account) {
  if (typeof account !== 'string' || !account || account.length > 200) throw new Error('Invalid account identity');
  const previous = config.reportAccount;
  if (!previous) { config.reportAccount = account; return false; }
  if (previous === account) return false;
  const reports = Array.isArray(config.accountReports) ? config.accountReports : [];
  const saved = reports.find(report => report && report.account === account);
  const archived = {
    account: previous, daily: config.daily || {}, purchases: config.purchases || [],
    chestDaily: config.chestDaily || {}, chestsClaimed: config.chestsClaimed || 0,
  };
  config.accountReports = [...reports.filter(report => report && report.account !== previous && report.account !== account), archived];
  config.daily = saved && saved.daily && typeof saved.daily === 'object' && !Array.isArray(saved.daily) ? saved.daily : {};
  config.purchases = saved && Array.isArray(saved.purchases) ? saved.purchases : [];
  config.chestDaily = saved && saved.chestDaily && typeof saved.chestDaily === 'object' && !Array.isArray(saved.chestDaily) ? saved.chestDaily : {};
  config.chestsClaimed = saved && Number.isFinite(saved.chestsClaimed) ? saved.chestsClaimed : 0;
  config.reportAccount = account;
  return true;
}

module.exports = { selectReportAccount };

