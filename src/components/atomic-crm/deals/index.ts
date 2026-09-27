import React from "react";

const DealList = React.lazy(() => import("./DealList"));
const DealPage = React.lazy(() =>
  import("./page/DealPage").then((module) => ({ default: module.DealPage })),
);

export default {
  list: DealList,
  show: DealPage,
};
