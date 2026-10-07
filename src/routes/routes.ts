import { RouteNamesEnum } from 'localConstants';
import { Create } from 'pages/Create/Create';
import { Guide } from 'pages/Guide/Guide';
import { Safe } from 'pages/Safe/Safe';
import { Safes } from 'pages/Safes/Safes';
import { RouteType } from 'types';

interface RouteWithTitleType extends RouteType {
  title: string;
  authenticatedRoute?: boolean;
  children?: RouteWithTitleType[];
}

// Both routes are public: this milestone only reads the chain. Signing arrives
// with the wallet milestone, and the routes that need a connected board member
// will be marked authenticatedRoute then.
export const routes: RouteWithTitleType[] = [
  {
    path: RouteNamesEnum.home,
    title: 'Safes',
    component: Safes
  },
  {
    path: RouteNamesEnum.safe,
    title: 'Safe',
    component: Safe
  },
  {
    path: RouteNamesEnum.guide,
    title: 'How it works',
    component: Guide
  },
  {
    path: RouteNamesEnum.create,
    title: 'Create a safe',
    component: Create
  }
];
