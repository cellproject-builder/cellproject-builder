import * as icons from '@radix-ui/react-icons';
import { Icon } from '../ui';

/** Loaded only for the extended catalog; common soft icons remain immediate. */
export default function RadixProjectIcon({ id, size }: { id: string; size: number }) {
  const Component = Object.hasOwn(icons, id) ? icons[id as keyof typeof icons] : null;
  return Component ? <Component width={size} height={size} /> : <Icon name="planner" size={size} />;
}
