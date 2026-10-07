import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UnlockPanelManager, useGetLoginInfo } from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';
import { RouteNamesEnum } from 'localConstants';

export const Unlock = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useGetLoginInfo();

  const unlockPanelManager = UnlockPanelManager.init({
    allowedProviders: ALLOWED_WALLETS,
    loginHandler: () => {
      navigate(RouteNamesEnum.home);
    },
    onClose: async () => {
      navigate(RouteNamesEnum.home);
    }
  });

  const handleOpenUnlockPanel = () => {
    unlockPanelManager.openUnlockPanel();
  };

  useEffect(() => {
    if (isLoggedIn) {
      navigate(RouteNamesEnum.home);
      return;
    }

    handleOpenUnlockPanel();
  }, [isLoggedIn]);

  return null;
};
