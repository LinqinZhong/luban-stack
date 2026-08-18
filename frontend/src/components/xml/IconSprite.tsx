import { iconSymbolId, type IconLibrary } from '../../types/icon-library'
import './IconSprite.css'

export default function IconSprite({ library }: { library: IconLibrary }) {
  return (
    <svg
      className="icon-sprite"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {library.icons.map((icon) => (
        <symbol
          key={icon.id}
          id={iconSymbolId(icon.id)}
          viewBox={icon.viewBox}
          dangerouslySetInnerHTML={{ __html: icon.content }}
        />
      ))}
    </svg>
  )
}
