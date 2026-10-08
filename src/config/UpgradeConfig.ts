/**
 * 已废弃 —— 请改用 ./CultivationUpgradeConfig
 *
 * 原 Upgrade.apply 的签名是 (player: Player),无法表达
 * 「某门法术+1级」「+1 法术槽」这类需要跨系统判断的卡,
 * 因此升级池已迁移到 CultivationUpgradeConfig.ts,签名改为 (ctx: UpgradeContext)。
 * 这里只保留一个转发出口,方便过渡期内的旧引用。
 */
export {
  STAT_UPGRADES,
  MAX_BONUS_SPELL_SLOTS,
} from './CultivationUpgradeConfig';