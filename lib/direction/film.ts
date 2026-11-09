import type {FilmProject, Shot} from '../film/types.ts'
import type {DirectionShot} from '../../shared/direction.ts'
export function filmShots(data: FilmProject): DirectionShot[] {
    return (data.coverage ?? []).flatMap(group =>
        group.shots.map((shot, i) => ({
            id: `${group.sceneId}:shot${i + 1}`,
            groupId: group.sceneId,
            characters: shot.characters,
            data: structuredClone(shot) as Record<string, unknown>,
        })),
    )
}
export function putFilmShot(data: FilmProject, id: string, shot: Record<string, unknown>) {
    const found = filmShots(data).find(s => s.id === id)
    if (!found) throw Error(`missing shot ${id}`)
    data.coverage!.find(g => g.sceneId === found.groupId)!.shots[Number(id.slice(id.lastIndexOf('shot') + 4)) - 1] = shot as Shot
}
export const filmContext = (data: FilmProject) => ({
    screenplay: data.screenplay,
    cast: data.cast,
    lookBrief: data.lookBrief,
    characterDescriptions: data.characterDescriptions,
    locationDescriptions: data.locationDescriptions,
    characterLooks: data.characterLooks,
    locationLooks: data.locationLooks,
    locationViews: data.locationViews,
    coverage: data.coverage,
    props: data.props,
})
