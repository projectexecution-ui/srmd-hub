import { MastersNav } from './MastersNav'

/** One shell for every Masters screen: the sub-nav stays put so the set is
 *  always in reach, and each page supplies only its own content. */
export default function MastersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <MastersNav />
      <div className="pt-4">{children}</div>
    </div>
  )
}
