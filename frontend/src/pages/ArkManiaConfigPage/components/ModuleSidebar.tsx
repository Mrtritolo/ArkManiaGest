/**
 * Rail of plugin modules. Below 900px it becomes a horizontal scroller that
 * keeps its labels (the old rail hid them, leaving unlabelled icons).
 */
import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MODULE_ICONS, type ConfigModule } from '../configModel'
import styles from '../ArkManiaConfigPage.module.css'

interface Props {
  modules: ConfigModule[]
  activeModule: string
  onSelect: (prefix: string) => void
}

export function ModuleSidebar({ modules, activeModule, onSelect }: Props) {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('arkmaniaConfig.plugins')}>
      <ul className="l-rail">
        {modules.map(module => {
          const Icon = MODULE_ICONS[module.prefix] || Settings
          return (
            <li key={module.prefix}>
              <button
                type="button"
                className="ui-nav-item"
                aria-current={activeModule === module.prefix ? 'true' : undefined}
                onClick={() => onSelect(module.prefix)}
              >
                <Icon aria-hidden="true" />
                <span className={`u-truncate ${styles.navLabel}`}>{module.label}</span>
                <span className="ui-count">{module.key_count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
