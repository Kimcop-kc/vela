/**
 * 故事圣经 · 角色分区
 *
 * 只读：角色卡 + 当前状态摘要。筛选（关键词）由外层页面完成，这里拿到的已是过滤后的列表。
 */
import { useTranslation } from 'react-i18next'
import type { CharacterCard } from '../../../stores/character-store'
import { EmptyLine } from './parts'

export function CharactersSection({ characters }: { characters: CharacterCard[] }) {
  const { t } = useTranslation('pages')

  if (characters.length === 0) return <EmptyLine text={t('storyBibleOverview.emptyCharacters')} />

  return (
    <div className="space-y-2">
      {characters.map(character => (
        <div key={character.name} className="px-3 py-3 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{character.name}</span>
            <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{character.role}</span>
            {character.currentState?.updatedAtChapter ? (
              <span className="text-[0.65rem] ml-auto" style={{ color: 'var(--color-text-muted)' }}>
                {t('storyBibleOverview.updatedAt', { chapter: character.currentState.updatedAtChapter })}
              </span>
            ) : null}
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{character.motivation || character.personality || t('storyBibleOverview.noDescription')}</p>
          {character.currentState && (
            <div className="text-[0.68rem] mt-2 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--color-text-muted)' }}>
              {character.currentState.location && <span>@ {character.currentState.location}</span>}
              {character.currentState.powerLevel && <span>{character.currentState.powerLevel}</span>}
              {character.currentState.recentEvents && <span>{character.currentState.recentEvents}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
