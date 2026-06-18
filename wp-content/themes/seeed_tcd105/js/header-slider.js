// Youtube variable
const tcdYoutubeVars = {
	headerYoutubes: document.querySelectorAll('.swiper-slide .bg_youtube[data-video-id]'),
	youTubeIframeAPIReady: false,
	players: {},
};

if (tcdYoutubeVars.headerYoutubes.length) {
	// Load Youtube IFrame Player API
	if (!document.querySelector('script[src*="//www.youtube.com/iframe_api"]')) {
		tcdYoutubeVars.ApiTag = document.createElement('script');
		tcdYoutubeVars.ApiTag.src = 'https://www.youtube.com/iframe_api';

		tcdYoutubeVars.firstScriptTag =document.getElementsByTagName('script')[0];
		tcdYoutubeVars.firstScriptTag.parentNode.insertBefore(tcdYoutubeVars.ApiTag, tcdYoutubeVars.firstScriptTag);
	}

	window.onYouTubeIframeAPIReady = () => {
		tcdYoutubeVars.youTubeIframeAPIReady = true;
		window.dispatchEvent(new Event('tcdYouTubeIframeAPIReady'));
	};
}

window.addEventListener('initHeaderSlider', () => {
	const headerSlider = document.getElementById('header_slider');
	const headerSlides = headerSlider.querySelectorAll('.swiper-slide');
	let headerSwiper, firstItem, headerYoutubes;

	if (!headerSlider || !window.Swiper) {
		return;
	}

	// Video・Youtube再生監視間隔
	const observeInterval = 200;

	// Videoの再生コントロール
	const videoControll = (slide, action) => {
		const video = slide.querySelector('video');
		if (!video) {
			if (!headerSwiper.autoplay.running) {
				headerSwiper.autoplay.start();
			}
			return;
		}

		// Video再生監視
		const observeVideo = () => {
			if (video.paused) {
				clearInterval(video.tcdTimer);
				if (!headerSwiper.autoplay.running) {
					headerSwiper.autoplay.start();
				}
				if (slide.classList.contains('swiper-slide-active')) {
					headerSwiper.slideNext(headerSwiper.params.speed, true);
				}
			} else if (
				slide.classList.contains('swiper-slide-active') &&
				video.duration - video.currentTime < (headerSwiper.params.speed + observeInterval) / 1000
			) {
				clearInterval(video.tcdTimer);
				headerSwiper.autoplay.start();
				headerSwiper.slideNext(headerSwiper.params.speed, true);
			}
		};

		if (action === 'play') {
			headerSwiper.autoplay.stop();
			video.currentTime = 0;
			video.muted = true;
			if (headerSwiper.slides.length === 1) {
				video.loop = true;
			}
			video.play();
			video.tcdTimer = setInterval(observeVideo, observeInterval);
		} else if (action === 'pause') {
			clearInterval(video.tcdTimer);
			video.pause();
		}
	};

	// Youtubeの再生コントロール
	const youtubeControll = (slide, action) => {
		const ytelem = slide.querySelector('.bg_youtube');
		if (!ytelem) {
			return;
		}
		if (!ytelem.id) {
			ytelem.id = 'youtube-' + (Math.floor(Math.random() * (99999 - 10000)) + 10000);
		}

		// Youtube再生監視
		const observeYoutube = () => {
			if (!ytelem.id || !tcdYoutubeVars.players[ytelem.id]) {
				return;
			}

			const player = tcdYoutubeVars.players[ytelem.id];

			switch (player.getPlayerState()) {
				case 3: // YT.PlayerState.BUFFERING
					break;

				case 1: // YT.PlayerState.PLAYING
					if (
						slide.classList.contains('swiper-slide-active') &&
						player.getDuration() - player.getCurrentTime() < (headerSwiper.params.speed + observeInterval) / 1000
					) {
						clearInterval(player.tcdTimer);
						headerSwiper.autoplay.start();
						headerSwiper.slideNext(headerSwiper.params.speed, true);
					}
					break;

				case 0: // YT.PlayerState.ENDED
				case 2: // YT.PlayerState.PAUSED
					clearInterval(player.tcdTimer);
					if (!headerSwiper.autoplay.running) {
						headerSwiper.autoplay.start();
					}
					if (slide.classList.contains('swiper-slide-active')) {
						headerSwiper.slideNext(headerSwiper.params.speed, true);
					}
					break;

				case 5: // YT.PlayerState.CUED
					if (slide.classList.contains('swiper-slide-active')) {
						player.playVideo();
					}
					break;

				case -1: // YT.PlayerState.UNSTARTED
				default:
					clearInterval(player.tcdTimer);
			}
		};

		if (action === 'play') {
			headerSwiper.autoplay.stop();
		}

		if (tcdYoutubeVars.players[ytelem.id]) {
			if (action === 'play') {
				tcdYoutubeVars.players[ytelem.id].seekTo(0, true);
				tcdYoutubeVars.players[ytelem.id].playVideo();
				clearInterval(tcdYoutubeVars.players[ytelem.id].tcdTimer);
				setTimeout(() => {
					tcdYoutubeVars.players[ytelem.id].tcdTimer = setInterval(observeYoutube, observeInterval);
				}, 500);
			} else if (action === 'pause') {
				clearInterval(tcdYoutubeVars.players[ytelem.id].tcdTimer);
				tcdYoutubeVars.players[ytelem.id].pauseVideo();
			}

			return;
		}

		const initSlideYoutube = () => {
			const player = new YT.Player(ytelem.id, {
				videoId: ytelem.dataset.videoId,
				playerVars: {
					controls: 0,
					fs: 0,
					iv_load_policy: 3,
					loop: headerSlides.length === 1 ? 1 : 0,
					mute: 1,
					playlist: headerSlides.length === 1 ? ytelem.dataset.videoId : null,
					playsinline: 1,
					rel: 0,
					showinfo: 0,
				},
				events: {
					onReady: (e) => {
						if (!tcdYoutubeVars.players[ytelem.id]) {
							tcdYoutubeVars.players[ytelem.id] = player;
							fitYoutube();

							if (action === 'play' && slide.classList.contains('swiper-slide-active')
							) {
								player.playVideo();
								setTimeout(() => {
									player.tcdTimer = setInterval(observeYoutube, observeInterval);
								}, 500);
							}
						}
					},
					// Swiperでloop: trueだとDOM操作でスライド順を操作する関係でonStateChangeは1週目しか動作しない
					//onStateChange: (e) => {},
				},
			});
		};

		if (tcdYoutubeVars.youTubeIframeAPIReady) {
			initSlideYoutube();
		} else {
			window.addEventListener('tcdYouTubeIframeAPIReady', initSlideYoutube, { once: true });
		}
	};

	// Youtube fit to slider
	const fitYoutube = () => {
		const styles = {};

		if (Math.floor((headerSwiper.height / headerSwiper.width) * 100) > 56) {
			// Slider size is horizontally longer than 16:9
			const ytw = Math.ceil((headerSwiper.height / 9) * 16);
			const ytl = (ytw - headerSwiper.width) / -2;
			styles.width = ytw + 'px';
			styles.left = ytl + 'px';
			styles.height = headerSwiper.height + 'px';
			styles.top = '0px';
		} else {
			// Slider size is vertically longer than 16: 9
			const yth = Math.ceil((headerSwiper.width / 16) * 9);
			const ytt = (yth - headerSwiper.height) / -2;
			styles.height = yth + 'px';
			styles.top = ytt + 'px';
			styles.width = headerSwiper.width + 'px';
			styles.left = '0px';
		}

		// iframe化でDOM変わるので再取得してスタイルセット
		headerYoutubes = headerSlider.querySelectorAll('.swiper-slide .bg_youtube');
		headerYoutubes.forEach((el) => {
			el.style.height = styles.height;
			el.style.left = styles.left;
			el.style.top = styles.top;
			el.style.width = styles.width;
		});
	};

	// 1枚目スライド
	firstItem = headerSlider.querySelector('.swiper-slide.first_item');

	// Youtubeスライドs
	headerYoutubes = headerSlider.querySelectorAll('.swiper-slide .bg_youtube');

	// Swiper
	headerSwiper = new Swiper(headerSlider, {
		effect: 'fade',
		loop: true,
		slidesPerView: 1,
		speed: headerSlider.dataset.fade_speed,
		autoplay: {
			delay: headerSlider.dataset.interval - 0 || 4000,
			disableOnInteraction: false,
		},
/*
		navigation: {
			nextEl: '.swiper-button-next',
			prevEl: '.swiper-button-prev',
		},
*/
		on: {
			resize: (swiper) => {
				if (headerYoutubes.length) {
					fitYoutube();
				}
			},
			slideChangeTransitionStart: (swiper) => {
				// 1枚目スライド first_itemクラス削除
				if (firstItem) {
					firstItem.classList.remove('disable-inner-transition', 'first_item');
					firstItem = null;
				}

				const newSlide = swiper.slides[swiper.activeIndex];
				const prevSlide = swiper.previousIndex !== undefined ? swiper.slides[swiper.previousIndex] : null;

				if (newSlide.dataset.itemType === 'type2') {
					videoControll(newSlide, 'play');
				} else if (newSlide.dataset.itemType === 'type3') {
					youtubeControll(newSlide, 'play');
				} else if (!swiper.autoplay.running) {
					swiper.autoplay.start();
				}

				newSlide.classList.remove('p-effect-reverse', 'p-effect-slidein', 'p-effect-slideout');

				prevSlide && prevSlide.classList.remove('p-effect-reverse', 'p-effect-slideout');

				// クラスのslidePrevTransitionStartを待つためsetTimeout
				setTimeout(() => {
					newSlide.classList.add('p-effect-slidein');
					prevSlide && prevSlide.classList.remove('p-effect-slidein');
					prevSlide && prevSlide.classList.add('p-effect-slideout');
				}, 1);
			},
			slideChangeTransitionEnd: (swiper) => {
				const newSlide = swiper.slides[swiper.activeIndex];
				const prevSlide = swiper.previousIndex !== undefined ? swiper.slides[swiper.previousIndex] : null;

				newSlide.classList.remove('p-effect-reverse');

				if (prevSlide) {
					if (prevSlide.dataset.itemType === 'type2') {
						videoControll(prevSlide, 'pause');
					} else if (prevSlide.dataset.itemType === 'type3') {
						youtubeControll(prevSlide, 'pause');
					}

					prevSlide.classList.remove('p-effect-reverse', 'p-effect-slidein', 'p-effect-slideout');
				}
			},
			slidePrevTransitionStart: (swiper) => {
				const newSlide = swiper.slides[swiper.activeIndex];
				const prevSlide = swiper.previousIndex !== undefined ? swiper.slides[swiper.previousIndex] : null;

				// 戻るエフェクト
				newSlide.classList.add('p-effect-reverse');
				prevSlide && prevSlide.classList.add('p-effect-reverse');
			},
		},
	});

	// 1枚目スライドエフェクト
	firstItem.classList.add('p-effect-slidein');

	// 1枚目スライドが動画・Youtubeの対策
	if (firstItem.dataset.itemType === 'type2') {
		videoControll(firstItem, 'play');
	} else if (firstItem.dataset.itemType === 'type3') {
		youtubeControll(firstItem, 'play');
	}
});