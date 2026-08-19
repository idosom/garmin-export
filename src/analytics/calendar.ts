/** Day bucketing shared by the calendar, training and overview views. */
import type { Activity } from '../core/types.ts';
import { localDayKey, viewerDayKey } from '../core/time.ts';

/**
 * The calendar day an activity belongs to. FIT files tell us the offset that
 * was in force where the activity happened; everything else falls back to the
 * viewer's timezone, which is the best available answer.
 */
export function activityDayKey(activity: Activity): string {
  return activity.timezoneOffsetMin !== undefined && activity.timezoneOffsetMin !== null
    ? localDayKey(activity.startTime, activity.timezoneOffsetMin)
    : viewerDayKey(activity.startTime);
}

export interface DayBucket {
  date: string;
  activities: Activity[];
  count: number;
  duration: number;
  distance: number;
  load: number;
  sports: string[];
}

export function bucketByDay(activities: Activity[], loadOf?: (a: Activity) => number): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const activity of activities) {
    const date = activityDayKey(activity);
    let bucket = map.get(date);
    if (!bucket) {
      bucket = { date, activities: [], count: 0, duration: 0, distance: 0, load: 0, sports: [] };
      map.set(date, bucket);
    }
    bucket.activities.push(activity);
    bucket.count++;
    bucket.duration += activity.movingTime ?? activity.timerTime ?? activity.elapsedTime ?? 0;
    bucket.distance += activity.distance ?? 0;
    bucket.load += loadOf?.(activity) ?? 0;
    if (!bucket.sports.includes(activity.sport)) bucket.sports.push(activity.sport);
  }
  return map;
}
